"use client";

import type { Order } from "@/core/domain/orders";
import { deriveCardActions, RETRY_REFUND_OWNER_ONLY_TEXT, type CardAction } from "../orderActions";

type OrderActionsProps = {
  order: Order;
  busy?: boolean;
  // Só o dono tenta o estorno de novo (a API recusa o resto). Papel desconhecido conta como "não é o dono".
  canRetryRefund?: boolean;
  onAdvance: (order: Order, action: CardAction) => void;
  onOpenCancel: (order: Order, action: CardAction) => void;
  onUndo: (order: Order) => void;
  onRetryRefund: (order: Order) => void;
};

// Botões do pedido (principal, recusar, menu ⋯) vindos de `allowedTransitions`/`blocked`. Usados no cartão do quadro
// e no rodapé do detalhe: as duas telas mostram as MESMAS ações, nunca regras diferentes.
export function OrderActions({ order, busy = false, canRetryRefund = false, onAdvance, onOpenCancel, onUndo, onRetryRefund }: OrderActionsProps) {
  const actions = deriveCardActions(order);
  // Botão bloqueado: continua visível e o MOTIVO aparece escrito (não só um botão cinza), ligado por aria-describedby.
  function blockedButton(action: CardAction, className: string) {
    const reasonId = `bloqueio-${order.id}-${action.to}-${action.kind}`;
    return (
      <span className="pedidos-card__blocked" key={reasonId}>
        <button type="button" className={className} aria-disabled="true" aria-describedby={reasonId} onClick={(event) => event.preventDefault()}>
          {action.label}
        </button>
        <span id={reasonId} className="pedidos-card__reason">
          {action.disabledReason}
        </span>
      </span>
    );
  }

  const menuItems = actions.menu;
  const hasMenu = menuItems.length > 0 || actions.undo.enabled || actions.refundPending || Boolean(actions.undo.reason);

  return (
    <div className="pedidos-card__actions">
      {actions.secondary &&
        (actions.secondary.disabledReason ? (
          blockedButton(actions.secondary, "pedidos-card__secondary")
        ) : (
          <button type="button" className="pedidos-card__secondary" disabled={busy} onClick={() => onOpenCancel(order, actions.secondary as CardAction)}>
            {actions.secondary.label}
          </button>
        ))}
      {actions.primary && (
        <button type="button" className="pedidos-card__primary" disabled={busy} onClick={() => onAdvance(order, actions.primary as CardAction)}>
          {busy ? "Aguarde…" : actions.primary.label}
        </button>
      )}
      {hasMenu && (
        <details className="pedidos-card__menu">
          <summary aria-label={`Mais ações do pedido ${order.code}`}>
            <span aria-hidden="true">⋯</span>
          </summary>
          <div className="pedidos-card__menu-list">
            {actions.refundPending &&
              (canRetryRefund ? (
                <button type="button" disabled={busy} onClick={() => onRetryRefund(order)}>
                  Tentar estorno
                </button>
              ) : (
                <span className="pedidos-card__reason">{RETRY_REFUND_OWNER_ONLY_TEXT}</span>
              ))}
            {actions.undo.enabled && (
              <button type="button" disabled={busy} onClick={() => onUndo(order)}>
                Voltar um passo
              </button>
            )}
            {!actions.undo.enabled && actions.undo.reason && <span className="pedidos-card__reason">{actions.undo.reason}</span>}
            {menuItems.map((action) =>
              action.disabledReason ? (
                blockedButton(action, "pedidos-card__menu-danger")
              ) : (
                <button key={`${action.to}-${action.kind}`} type="button" className="pedidos-card__menu-danger" disabled={busy} onClick={() => onOpenCancel(order, action)}>
                  {action.label}
                </button>
              ),
            )}
          </div>
        </details>
      )}
    </div>
  );
}
