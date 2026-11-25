"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { statusLabel } from "@/core/domain/orderLabels";
import type { Order } from "@/core/domain/orders";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { Button, PageHeading, StateMessage } from "@/shared/design/components";
import type { CardAction } from "./orderActions";
import { CancelOrderDialog } from "./components/CancelOrderDialog";
import { OrderCard } from "./components/OrderCard";
import { HISTORY_OPEN_HREF, HISTORY_HREF, hiddenOpenParts } from "./hiddenOpen";
import { UndoToast } from "./components/UndoToast";
import Link from "next/link";
import { OrderDetailPanel } from "./detail/OrderDetailPanel";
import { detailRefreshKey } from "./detail/detailRefreshKey";
import { useNow } from "./hooks/useNow";
import { usePedidos } from "./hooks/usePedidos";
import { KANBAN_COLUMNS, groupOrders } from "./kanban";
import "./pedidos.css";
import "./pedidos-acoes.css";
import "./pedidos-detalhe.css";

type CancelTarget = { order: Order; action: CardAction } | null;

// "Tentar estorno": a folha reabre já no passo de repetir o estorno (o estado vem do pedido, não da folha).
const RETRY_REFUND_ACTION: CardAction = { to: "CANCELADO", label: "Tentar estorno", kind: "CANCEL", primary: false, requiresReason: false, refund: true, disabledReason: null };

export function PedidosPage() {
  const p = usePedidos();
  const nowMs = useNow();
  const role = useCurrentRole();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Detalhe aberto = `?pedido=<id>` na URL (compartilhável entre abas; o botão voltar do navegador fecha o detalhe).
  const selectedId = searchParams.get("pedido");
  const desktop = useMediaQuery("(min-width: 1100px)");
  const openedHere = useRef(false);
  const lastOpened = useRef<string | null>(null);
  const groups = groupOrders(p.orders);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget>(null);
  // No celular o quadro vira abas por estado (spec 02 §3); no desktop todas as colunas aparecem.
  const [tab, setTab] = useState<string>(KANBAN_COLUMNS[0]);

  // Pedido que o servidor já mudou/sumiu enquanto a folha estava aberta: a folha acompanha o pedido atual.
  const current = cancelTarget ? (p.orders.find((order) => order.id === cancelTarget.order.id) ?? cancelTarget.order) : null;

  const openDetail = useCallback(
    (orderId: string) => {
      openedHere.current = true;
      lastOpened.current = orderId;
      router.push(`/dashboard/pedidos?pedido=${encodeURIComponent(orderId)}`);
    },
    [router],
  );
  // Fechar volta uma entrada se fomos nós que abrimos; se a pessoa chegou direto pelo link, só tira o parâmetro.
  const closeDetail = useCallback(() => {
    if (openedHere.current) {
      openedHere.current = false;
      router.back();
    } else {
      router.replace("/dashboard/pedidos");
    }
  }, [router]);

  // Painel lateral fechado: o foco volta ao cartão que o abriu (a folha modal já devolve sozinha ao fechar).
  useEffect(() => {
    if (selectedId || !desktop || !lastOpened.current) return;
    const id = lastOpened.current;
    lastOpened.current = null;
    const button = Array.from(document.querySelectorAll<HTMLElement>("[data-order-id]")).find((node) => node.getAttribute("data-order-id") === id)?.querySelector<HTMLElement>(".pedidos-card__open");
    button?.focus();
  }, [selectedId, desktop]);

  const card = (order: Order, readOnly = false) => (
    <OrderCard
      key={order.id}
      order={order}
      deliverers={p.deliverers}
      nowMs={nowMs}
      busy={p.busyId === order.id}
      readOnly={readOnly}
      canRetryRefund={role === "OWNER"}
      onOpen={(target) => openDetail(target.id)}
      onAdvance={p.transition}
      onOpenCancel={(target, action) => setCancelTarget({ order: target, action })}
      onUndo={(target) => p.undo(target.id)}
      onRetryRefund={(target) => setCancelTarget({ order: target, action: RETRY_REFUND_ACTION })}
      onAssignDeliverer={p.assignDeliverer}
    />
  );

  return (
    <main className={`pedidos${selectedId && desktop ? " pedidos--with-detail" : ""}`}>
      <div className="pedidos__content">
      <PageHeading title="Pedidos" actions={<>
        <Link href={HISTORY_HREF} className="ds-button ds-button--secondary">Histórico</Link>
        <Link href="/dashboard/pedidos/pix" className="ds-button ds-button--secondary">Pix pendentes</Link>
      <Link href="/dashboard/pedidos/agendados" className="ds-button ds-button--secondary">Agendados</Link>
        <Link href="/dashboard/pedidos/novo" className="ds-button ds-button--primary">Novo pedido</Link>
      </>} />

      {p.notice && (
        <div role="alert" className="pedidos__notice">
          <span>{p.notice}</span>
          <button type="button" onClick={p.dismissNotice} aria-label="Fechar aviso">
            ✕
          </button>
        </div>
      )}

      {/* 1ª carga: nem abas nem colunas, para "carregando" nunca parecer "nenhum pedido". */}
      {p.loadState === "loading" && (
        <div role="status" className="pedidos__loading">
          <span className="pedidos__spinner" aria-hidden="true" />
          Carregando pedidos…
        </div>
      )}
      {p.loadState === "error" && (
        <StateMessage tone="danger" title="Não foi possível carregar os pedidos. Verifique sua internet."
          action={<Button onClick={p.retryLoad}>Tentar de novo</Button>} />
      )}

      {/* API-70: o teto de abertos deixou pedidos ANTIGOS de fora do quadro (os mais novos sempre aparecem). A faixa diz quantos. */}
      {p.loadState === "ready" && p.openHidden > 0 && (
        <div role="status" className="pedidos__capped">
          <svg className="pedidos__capped-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p>
            {hiddenOpenParts(p.openHidden).before}
            <Link href={HISTORY_OPEN_HREF} className="pedidos__capped-link">
              {hiddenOpenParts(p.openHidden).link}
            </Link>
            {hiddenOpenParts(p.openHidden).after}
          </p>
        </div>
      )}

      {p.loadState === "ready" && (
      <div className="pedidos__tabs" role="group" aria-label="Etapas do pedido">
        {KANBAN_COLUMNS.map((status) => (
          <button key={status} type="button" aria-pressed={tab === status} className={tab === status ? "is-active" : undefined} onClick={() => setTab(status)}>
            {statusLabel(status)} <span className="pedidos__count">{groups.byStatus[status].length}</span>
          </button>
        ))}
      </div>
      )}

      {p.loadState === "ready" && (
      <div className="pedidos__board">
        {KANBAN_COLUMNS.map((status) => (
          <section key={status} className={`pedidos__column${tab === status ? " is-active" : ""}`} aria-label={statusLabel(status)}>
            <h2>
              {statusLabel(status)} <span className="pedidos__count">{groups.byStatus[status].length}</span>
            </h2>
            <div className="pedidos__list">
              {groups.byStatus[status].map((order) => card(order))}
              {groups.byStatus[status].length === 0 && <p className="pedidos__empty">Nenhum pedido aqui.</p>}
            </div>
          </section>
        ))}
        {/* Coletor: pedido com status que esta tela ainda não conhece nunca some (contrato B3 §10). Sem ações. */}
        {groups.others.length > 0 && (
          <section className="pedidos__column pedidos__column--others is-active" aria-label="Outros">
            <h2>Outros</h2>
            <p className="pedidos__column-hint">Pedidos com um status que esta tela ainda não conhece. Eles ficam aqui para você não perder nenhum.</p>
            <div className="pedidos__list">{groups.others.map((order) => card(order, true))}</div>
          </section>
        )}
      </div>
      )}

      {p.undoOffer && <UndoToast text={p.undoOffer.text} onUndo={() => p.undo(p.undoOffer!.orderId)} onDismiss={p.dismissUndo} />}

      {cancelTarget && current && (
        <CancelOrderDialog
          order={current}
          refund={cancelTarget.action.refund}
          onConfirm={(draft) => p.cancel(current, draft)}
          onRetryRefund={() => p.retryRefund(current)}
          onClose={() => setCancelTarget(null)}
        />
      )}
      </div>

      {selectedId && (
        <OrderDetailPanel
          orderId={selectedId}
          listOrder={p.orders.find((order) => order.id === selectedId)}
          refreshKey={detailRefreshKey(p.orders.find((order) => order.id === selectedId))}
          deliverers={p.deliverers}
          nowMs={nowMs}
          busy={p.busyId === selectedId}
          canRetryRefund={role === "OWNER"}
          desktop={desktop}
          onClose={closeDetail}
          onAdvance={p.transition}
          onOpenCancel={(target, action) => setCancelTarget({ order: target, action })}
          onUndo={(target) => p.undo(target.id)}
          onRetryRefund={(target) => setCancelTarget({ order: target, action: RETRY_REFUND_ACTION })}
          onAssignDeliverer={p.assignDeliverer}
        />
      )}
    </main>
  );
}
