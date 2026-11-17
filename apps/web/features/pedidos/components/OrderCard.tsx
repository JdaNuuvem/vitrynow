"use client";

import { statusLabel, TYPE_LABELS } from "@/core/domain/orderLabels";
import type { Deliverer, Order } from "@/core/domain/orders";
import { formatCents } from "@/shared/format/money";
import { ageLevel, ageText, orderAgeMinutes } from "../orderAge";
import { deriveCardActions, RETRY_REFUND_OWNER_ONLY_TEXT, type CardAction } from "../orderActions";

type OrderCardProps = {
  order: Order;
  deliverers: Deliverer[];
  nowMs: number;
  busy?: boolean;
  // Sem ações: pedido no coletor "Outros" (status que esta tela não conhece). Mostra, não opera.
  readOnly?: boolean;
  // Só o dono tenta o estorno de novo (a API recusa o resto). Papel desconhecido conta como "não é o dono".
  canRetryRefund?: boolean;
  onAdvance: (order: Order, action: CardAction) => void;
  onOpenCancel: (order: Order, action: CardAction) => void;
  onUndo: (order: Order) => void;
  onRetryRefund: (order: Order) => void;
  onAssignDeliverer: (order: Order, delivererId: string) => void;
};

// Selos de situação de pagamento (spec 02 §2): no máximo 2, o texto sempre diz o estado.
function paymentBadges(order: Order): { text: string; tone: "ok" | "warn" | "danger" }[] {
  const badges: { text: string; tone: "ok" | "warn" | "danger" }[] = [];
  if (order.payment?.refundPending) badges.push({ text: "Estorno pendente", tone: "danger" });
  else if (order.payment?.status === "APROVADO") badges.push({ text: "PIX pago ✓", tone: "ok" });
  else if (order.payment?.status === "REEMBOLSADO") badges.push({ text: "Estornado", tone: "ok" });
  else if (order.payment?.status === "PENDENTE") badges.push({ text: "Pagamento pendente", tone: "warn" });
  return badges.slice(0, 2);
}

export function OrderCard({ order, deliverers, nowMs, busy = false, readOnly = false, canRetryRefund = false, onAdvance, onOpenCancel, onUndo, onRetryRefund, onAssignDeliverer }: OrderCardProps) {
  const actions = deriveCardActions(order);
  const selectable = deliverers.filter((deliverer) => deliverer.active || deliverer.id === order.delivererId);
  const minutes = orderAgeMinutes(order, nowMs);
  const level = ageLevel(minutes, order.status);
  const age = ageText(minutes);
  const badges = paymentBadges(order);
  const itemsText = order.items.map((item) => `${item.quantity}× ${item.productName}`);
  const shownItems = itemsText.slice(0, 2).join(" · ");
  const hiddenItems = itemsText.length - 2;

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

  const menuItems = readOnly ? [] : actions.menu;
  const hasMenu = menuItems.length > 0 || actions.undo.enabled || actions.refundPending || Boolean(actions.undo.reason);

  return (
    <article className="pedidos-card" aria-label={`Pedido ${order.code}`}>
      <div className="pedidos-card__head">
        <strong>#{order.code}</strong>
        <span className="pedidos-card__chip">{statusLabel(order.status)}</span>
        {age && (
          <span className={`pedidos-card__age pedidos-card__age--${level}`}>
            {level === "danger" && <span aria-hidden="true">⛔ </span>}
            {level === "warn" && <span aria-hidden="true">⚠ </span>}
            {age}
          </span>
        )}
      </div>
      <div className="pedidos-card__body">
        <span>
          {TYPE_LABELS[order.type] ?? order.type} · {order.customerName ?? "Cliente não informado"}
        </span>
        <span>
          {shownItems}
          {hiddenItems > 0 && ` · +${hiddenItems} ${hiddenItems === 1 ? "item" : "itens"}`}
        </span>
        <span className="pedidos-card__total">
          {formatCents(order.totalCents)}
          {badges.map((badge) => (
            <span key={badge.text} className={`pedidos-card__badge pedidos-card__badge--${badge.tone}`}>
              {badge.text}
            </span>
          ))}
        </span>
      </div>

      {order.type === "DELIVERY" && !readOnly && (
        <select value={order.delivererId ?? ""} onChange={(event) => onAssignDeliverer(order, event.target.value)} aria-label={`Entregador do pedido ${order.code}`}>
          <option value="">Sem entregador</option>
          {selectable.map((deliverer) => (
            <option key={deliverer.id} value={deliverer.id}>
              {deliverer.name}
            </option>
          ))}
        </select>
      )}

      {!readOnly && (
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
      )}
    </article>
  );
}
