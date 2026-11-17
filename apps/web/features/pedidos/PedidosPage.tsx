"use client";

import { useState } from "react";
import { statusLabel } from "@/core/domain/orderLabels";
import type { Order } from "@/core/domain/orders";
import type { CardAction } from "./orderActions";
import { CancelOrderDialog } from "./components/CancelOrderDialog";
import { OrderCard } from "./components/OrderCard";
import { UndoToast } from "./components/UndoToast";
import { useNow } from "./hooks/useNow";
import { usePedidos } from "./hooks/usePedidos";
import { KANBAN_COLUMNS, groupOrders } from "./kanban";
import "./pedidos.css";
import "./pedidos-acoes.css";

type CancelTarget = { order: Order; action: CardAction } | null;

export function PedidosPage() {
  const p = usePedidos();
  const nowMs = useNow();
  const groups = groupOrders(p.orders);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget>(null);
  // No celular o quadro vira abas por estado (spec 02 §3); no desktop todas as colunas aparecem.
  const [tab, setTab] = useState<string>(KANBAN_COLUMNS[0]);

  // Pedido que o servidor já mudou/sumiu enquanto a folha estava aberta: a folha acompanha o pedido atual.
  const current = cancelTarget ? (p.orders.find((order) => order.id === cancelTarget.order.id) ?? cancelTarget.order) : null;

  const card = (order: Order, readOnly = false) => (
    <OrderCard
      key={order.id}
      order={order}
      deliverers={p.deliverers}
      nowMs={nowMs}
      busy={p.busyId === order.id}
      readOnly={readOnly}
      onAdvance={p.transition}
      onOpenCancel={(target, action) => setCancelTarget({ order: target, action })}
      onUndo={(target) => p.undo(target.id)}
      onRetryRefund={(target) => setCancelTarget({ order: target, action: { to: "CANCELADO", label: "Tentar estorno", kind: "CANCEL", primary: false, requiresReason: false, refund: true, disabledReason: null } })}
      onAssignDeliverer={p.assignDeliverer}
    />
  );

  return (
    <main className="pedidos">
      <h1>Pedidos</h1>

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
        <div role="alert" className="pedidos__notice">
          <span>Não foi possível carregar os pedidos. Verifique sua internet.</span>
          <button type="button" className="pedidos__retry" onClick={p.retryLoad}>
            Tentar de novo
          </button>
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
    </main>
  );
}
