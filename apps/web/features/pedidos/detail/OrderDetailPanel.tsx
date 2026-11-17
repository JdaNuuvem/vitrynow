"use client";

import { useEffect, useRef } from "react";
import type { Deliverer, Order } from "@/core/domain/orders";
import { Modal } from "@/shared/ui/Modal";
import { OrderDetailView, type DetailHandlers } from "./OrderDetailView";
import { useOrderDetail } from "./useOrderDetail";

type Props = {
  orderId: string;
  // O que o quadro já sabe deste pedido: dá o título enquanto o detalhe carrega.
  listOrder: Order | undefined;
  // Muda quando o quadro mudou o pedido: o detalhe recarrega sozinho.
  refreshKey: string;
  deliverers: Deliverer[];
  nowMs: number;
  busy: boolean;
  canRetryRefund: boolean;
  // ≥ 1100 px: painel lateral que NÃO é modal (o quadro segue à vista). Abaixo: folha modal com foco preso.
  desktop: boolean;
  onClose: () => void;
} & DetailHandlers;

// Detalhe do pedido (spec 11 §2). Abrir nunca muda o pedido; as ações vêm do servidor (allowedTransitions/blocked).
export function OrderDetailPanel({ orderId, listOrder, refreshKey, deliverers, nowMs, busy, canRetryRefund, desktop, onClose, ...handlers }: Props) {
  const { state, retry } = useOrderDetail(orderId, refreshKey);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const detail = state.status === "ready" ? state.order : state.status === "error" ? state.order : null;
  const code = detail?.code ?? listOrder?.code ?? null;
  const title = code ? `Pedido #${code}` : "Pedido";

  // Painel lateral: o foco entra no título ao abrir (e ao trocar de pedido). A folha modal já leva o foco ao diálogo.
  useEffect(() => {
    if (desktop) titleRef.current?.focus({ preventScroll: true });
  }, [desktop, orderId]);

  // Esc fecha o painel lateral, mas não enquanto outra janela (cancelar, MFA) está aberta por cima: ela cuida do próprio Esc.
  useEffect(() => {
    if (!desktop) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [desktop, onClose]);

  const content = (
    <>
      <div className="pedido-detalhe__head">
        <h2 id="pedido-detalhe-titulo" ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" className="pedido-detalhe__close" onClick={onClose} aria-label="Fechar detalhe do pedido">
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {state.status === "loading" && (
        <div role="status" className="pedidos__loading">
          <span className="pedidos__spinner" aria-hidden="true" />
          Carregando pedido…
        </div>
      )}

      {state.status === "notfound" && (
        <p role="alert" className="pedido-detalhe__empty">
          Pedido não encontrado.
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="pedidos__notice">
          <span>Não foi possível abrir o pedido.</span>
          <button type="button" className="pedidos__retry" onClick={retry}>
            Tentar de novo
          </button>
        </div>
      )}

      {detail && (
        <OrderDetailView order={detail} deliverers={deliverers} nowMs={nowMs} busy={busy} canRetryRefund={canRetryRefund} {...handlers} />
      )}
    </>
  );

  if (!desktop) {
    return (
      <Modal open onClose={onClose} labelledBy="pedido-detalhe-titulo" width={560} sheetOnMobile>
        <div className="pedidos-detalhe pedidos-detalhe--sheet">{content}</div>
      </Modal>
    );
  }
  return (
    <aside className="pedidos-detalhe" aria-label={code ? `Detalhe do pedido ${code}` : "Detalhe do pedido"}>
      {content}
    </aside>
  );
}
