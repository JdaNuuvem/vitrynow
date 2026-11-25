"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCents } from "@/shared/format/money";
import { PageHeading, StateMessage } from "@/shared/design/components";
import type { HistoryQuery } from "@/core/domain/orderHistory";
import type { Order } from "@/core/domain/orders";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { CardAction } from "../orderActions";
import { CancelOrderDialog } from "../components/CancelOrderDialog";
import { UndoToast } from "../components/UndoToast";
import { OrderDetailPanel } from "../detail/OrderDetailPanel";
import { detailRefreshKey } from "../detail/detailRefreshKey";
import { useNow } from "../hooks/useNow";
import { usePedidos } from "../hooks/usePedidos";
import { HISTORY_HREF } from "../hiddenOpen";
import { customerText, formatWhen, rowBadges, statusChip, typeLabel } from "./historyFormat";
import { useOrderHistoryList } from "./useOrderHistoryList";
import { HistoryFilters, readHistoryFilters } from "./HistoryFilters";
import "../pedidos.css";
import "../pedidos-acoes.css";
import "../pedidos-detalhe.css";
import "./historico.css";

type CancelTarget = { order: Order; action: CardAction } | null;

const RETRY_REFUND_ACTION: CardAction = { to: "CANCELADO", label: "Tentar estorno", kind: "CANCEL", primary: false, requiresReason: false, refund: true, disabledReason: null };

// Textos desta tela. Os marcados (provisório) aguardam o Ogilvy.
export const HISTORY_EMPTY_TEXT = "Nenhum pedido encontrado.";
export const HISTORY_ERROR_TEXT = "Não foi possível carregar o histórico. Verifique sua internet."; // (provisório)
export const HISTORY_RATE_TEXT = "Muitas buscas em pouco tempo. Aguarde um instante."; // spec 10 §2.3 (CA-HP, anti-abuso)
export const HISTORY_MORE_ERROR_TEXT = "Não foi possível carregar mais pedidos."; // (provisório)

const countText = (total: number) => (total === 1 ? "1 pedido" : `${total.toLocaleString("pt-BR")} pedidos`);

// Histórico de pedidos, Fatia 1 (WEB-44, spec 10 §2): "Em aberto" sem limite de data (API-72), para o dono achar os pedidos antigos que o teto do quadro
// escondeu. Tocar numa linha abre o MESMO detalhe do quadro (WEB-26), com as ações que o servidor permite a cada papel.
export function HistoricoPage() {
  const p = usePedidos();
  const nowMs = useNow();
  const role = useCurrentRole();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("pedido");
  const desktop = useMediaQuery("(min-width: 1100px)");
  // "Em aberto" não manda período: a API devolve todo pedido aberto da loja, por mais antigo que seja (API-72).
  const [search, setSearch] = useState("");
  const query = useMemo(() => ({ ...readHistoryFilters(searchParams), q: search || undefined }), [searchParams, search]);
  const h = useOrderHistoryList(query);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget>(null);
  // Muda a cada ação concluída aqui: faz o detalhe aberto recarregar (o pedido pode nem estar no quadro).
  const [version, setVersion] = useState(0);
  const openedHere = useRef(false);
  const lastOpened = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);

  const refreshList = h.refresh;
  const afterAction = useCallback(() => {
    setVersion((value) => value + 1);
    refreshList();
  }, [refreshList]);

  // O quadro mudou por outro lado (tempo real, outra aba): a lista do histórico acompanha.
  const signature = useMemo(() => p.orders.map((order) => `${order.id}:${order.status}`).join(","), [p.orders]);
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    if (p.loadState !== "ready") return;
    if (lastSignature.current !== null && lastSignature.current !== signature) afterAction();
    lastSignature.current = signature;
  }, [p.loadState, signature, afterAction]);

  const current = cancelTarget ? (p.orders.find((order) => order.id === cancelTarget.order.id) ?? cancelTarget.order) : null;

  function applyFilters(filters: HistoryQuery) {
    setSearch(filters.q ?? "");
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (key !== "q" && value !== undefined && value !== "") params.set(key, String(value));
    }
    const suffix = params.toString();
    router.replace(suffix ? HISTORY_HREF + "?" + suffix : HISTORY_HREF, { scroll: false });
  }

  const openDetail = useCallback(
    (orderId: string) => {
      openedHere.current = true;
      lastOpened.current = orderId;
      const next = new URLSearchParams(searchParams.toString());
      next.set("pedido", orderId);
      router.push(HISTORY_HREF + "?" + next.toString(), { scroll: false });
    },
    [router, searchParams],
  );
  const closeDetail = useCallback(() => {
    if (openedHere.current) {
      openedHere.current = false;
      router.back();
    } else {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("pedido");
      const suffix = next.toString();
      router.replace(suffix ? HISTORY_HREF + "?" + suffix : HISTORY_HREF, { scroll: false });
    }
  }, [router, searchParams]);

  // Painel lateral fechado: o foco volta à linha que o abriu.
  useEffect(() => {
    if (selectedId || !desktop || !lastOpened.current) return;
    const id = lastOpened.current;
    lastOpened.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-order-id="${CSS.escape(id)}"] button`)?.focus();
  }, [selectedId, desktop]);

  // "Carregar mais" (acessível): o foco vai ao PRIMEIRO item novo.
  useEffect(() => {
    if (focusFrom.current === null || h.loadingMore) return;
    const index = focusFrom.current;
    focusFrom.current = null;
    listRef.current?.querySelectorAll<HTMLElement>("li button")[index]?.focus();
  }, [h.rows.length, h.loadingMore]);

  const loadMore = () => {
    focusFrom.current = h.rows.length;
    h.loadMore();
  };

  const advance = async (order: Order, action: CardAction) => {
    await p.transition(order, action);
    afterAction();
  };
  const undoById = async (orderId: string) => {
    await p.undo(orderId);
    afterAction();
  };
  const assign = async (order: Order, delivererId: string) => {
    await p.assignDeliverer(order, delivererId);
    afterAction();
  };

  return (
    <main className={`pedidos historico${selectedId && desktop ? " pedidos--with-detail" : ""}`}>
      <div className="pedidos__content">
        <PageHeading title="Histórico" actions={<Link href="/dashboard/pedidos" className="ds-button ds-button--secondary">Voltar aos pedidos</Link>} />
        <HistoryFilters key={JSON.stringify(query)} applied={query} onApply={applyFilters} />

        {p.notice && (
          <div role="alert" className="pedidos__notice">
            <span>{p.notice}</span>
            <button type="button" onClick={p.dismissNotice} aria-label="Fechar aviso">
              ✕
            </button>
          </div>
        )}

        {h.rateLimited && (
          <div role="status" className="pedidos__capped">
            <p>{HISTORY_RATE_TEXT}</p>
          </div>
        )}

        {h.loadState === "loading" && (
          <div role="status" className="pedidos__loading">
            <span className="pedidos__spinner" aria-hidden="true" />
            Carregando pedidos…
          </div>
        )}

        {h.loadState === "error" && !h.rateLimited && (
          <div role="alert" className="pedidos__notice">
            <span>{HISTORY_ERROR_TEXT}</span>
            <button type="button" className="pedidos__retry" onClick={h.retry}>
              Tentar de novo
            </button>
          </div>
        )}

        {h.loadState === "ready" && (
          <>
            <p className="historico__count" aria-live="polite">
              {h.total > 0 ? countText(h.total) : ""}
            </p>

            {h.rows.length === 0 ? (
              <StateMessage title={HISTORY_EMPTY_TEXT}>Ajuste os filtros para ampliar a busca.</StateMessage>
            ) : (
              <ul className="historico__list" ref={listRef}>
                {h.rows.map((row) => {
                  const chip = statusChip(row);
                  const badges = rowBadges(row);
                  const code = row.code.replace(/^#/, "");
                  return (
                    <li key={row.id} data-order-id={row.id}>
                      <button type="button" className="historico__row" aria-label={`Abrir pedido ${code}`} onClick={() => openDetail(row.id)}>
                        <span className="historico__code">#{code}</span>
                        <span className="historico__when">{formatWhen(row.createdAt, h.timezone)}</span>
                        <span className="historico__customer">{customerText(row)}</span>
                        <span className="historico__type">{typeLabel(row.type)}</span>
                        <span className="historico__total">{formatCents(row.totalCents)}</span>
                        <span className="historico__status">
                          <span className={`historico__chip historico__chip--${chip.tone}`}>
                            <span aria-hidden="true">{chip.icon} </span>
                            {chip.text}
                          </span>
                          {badges.shown.map((badge) => (
                            <span key={badge.text} className={`historico__badge historico__badge--${badge.tone}`}>
                              {badge.text}
                            </span>
                          ))}
                          {badges.more > 0 && <span className="historico__badge">+{badges.more}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {h.moreFailed && (
              <div role="alert" className="pedidos__notice">
                <span>{HISTORY_MORE_ERROR_TEXT}</span>
              </div>
            )}
            {h.hasMore && (
              <button type="button" className="historico__more" onClick={loadMore} disabled={h.loadingMore}>
                {h.loadingMore ? "Carregando…" : `Carregar mais (${h.rows.length} de ${h.total})`}
              </button>
            )}
          </>
        )}

        {p.undoOffer && <UndoToast text={p.undoOffer.text} onUndo={() => undoById(p.undoOffer!.orderId)} onDismiss={p.dismissUndo} />}

        {cancelTarget && current && (
          <CancelOrderDialog
            order={current}
            refund={cancelTarget.action.refund}
            onConfirm={async (draft) => {
              const outcome = await p.cancel(current, draft);
              if (outcome.kind !== "error") afterAction();
              return outcome;
            }}
            onRetryRefund={async () => {
              const outcome = await p.retryRefund(current);
              if (outcome.kind !== "error") afterAction();
              return outcome;
            }}
            onClose={() => setCancelTarget(null)}
          />
        )}
      </div>

      {selectedId && (
        <OrderDetailPanel
          orderId={selectedId}
          listOrder={p.orders.find((order) => order.id === selectedId)}
          refreshKey={`${version}|${detailRefreshKey(p.orders.find((order) => order.id === selectedId))}`}
          deliverers={p.deliverers}
          nowMs={nowMs}
          busy={p.busyId === selectedId}
          canRetryRefund={role === "OWNER"}
          desktop={desktop}
          onClose={closeDetail}
          onAdvance={advance}
          onOpenCancel={(target, action) => setCancelTarget({ order: target, action })}
          onUndo={(target) => undoById(target.id)}
          onRetryRefund={(target) => setCancelTarget({ order: target, action: RETRY_REFUND_ACTION })}
          onAssignDeliverer={assign}
        />
      )}
    </main>
  );
}
