"use client";

import { statusLabel, TYPE_LABELS } from "@/core/domain/orderLabels";
import type { Deliverer, Order } from "@/core/domain/orders";
import { formatCents } from "@/shared/format/money";
import { ageLevel, ageText, orderAgeMinutes } from "../orderAge";
import { deriveCardActions, type CardAction } from "../orderActions";
import { OrderActions } from "./OrderActions";

type OrderCardProps = {
  order: Order;
  deliverers: Deliverer[];
  nowMs: number;
  busy?: boolean;
  // Sem ações: pedido no coletor "Outros" (status que esta tela não conhece). Mostra, não opera.
  readOnly?: boolean;
  // Só o dono tenta o estorno de novo (a API recusa o resto). Papel desconhecido conta como "não é o dono".
  canRetryRefund?: boolean;
  // Tocar no número do pedido abre o detalhe (a área de toque cobre o cartão todo, ver pedidos-detalhe.css). Nunca avança o pedido.
  onOpen?: (order: Order) => void;
  onAdvance: (order: Order, action: CardAction) => void;
  onOpenCancel: (order: Order, action: CardAction) => void;
  onUndo: (order: Order) => void;
  onRetryRefund: (order: Order) => void;
  onAssignDeliverer: (order: Order, delivererId: string) => void;
};

// Selos de situação de pagamento (spec 02 §2): no máximo 2, o texto sempre diz o estado.
export function paymentBadges(order: Order): { text: string; tone: "ok" | "warn" | "danger" }[] {
  const badges: { text: string; tone: "ok" | "warn" | "danger" }[] = [];
  if (order.payment?.refundPending) badges.push({ text: "Estorno pendente", tone: "danger" });
  else if (order.payment?.status === "APROVADO") badges.push({ text: "PIX pago ✓", tone: "ok" });
  else if (order.payment?.status === "REEMBOLSADO") badges.push({ text: "Estornado", tone: "ok" });
  else if (order.payment?.status === "PENDENTE") badges.push({ text: "Pagamento pendente", tone: "warn" });
  return badges.slice(0, 2);
}

export function OrderCard({ order, deliverers, nowMs, busy = false, readOnly = false, canRetryRefund = false, onOpen, onAdvance, onOpenCancel, onUndo, onRetryRefund, onAssignDeliverer }: OrderCardProps) {
  const selectable = deliverers.filter((deliverer) => deliverer.active || deliverer.id === order.delivererId);
  const minutes = orderAgeMinutes(order, nowMs);
  const level = ageLevel(minutes, order.status);
  const age = ageText(minutes);
  const badges = paymentBadges(order);
  const itemsText = order.items.map((item) => `${item.quantity}× ${item.productName}`);
  const shownItems = itemsText.slice(0, 2).join(" · ");
  const hiddenItems = itemsText.length - 2;

  return (
    <article className="pedidos-card" aria-label={`Pedido ${order.code}`} data-order-id={order.id}>
      <div className="pedidos-card__head">
        {onOpen ? (
          <button type="button" className="pedidos-card__open" aria-label={`Abrir pedido ${order.code}`} onClick={() => onOpen(order)}>
            <strong>#{order.code}</strong>
          </button>
        ) : (
          <strong>#{order.code}</strong>
        )}
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
        <OrderActions order={order} busy={busy} canRetryRefund={canRetryRefund} onAdvance={onAdvance} onOpenCancel={onOpenCancel} onUndo={onUndo} onRetryRefund={onRetryRefund} />
      )}
    </article>
  );
}
