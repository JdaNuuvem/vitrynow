"use client";

import type { Deliverer, Order } from "@/core/domain/orders";
import { formatCents } from "@/shared/format/money";

type OrderCardProps = {
  order: Order;
  deliverers: Deliverer[];
  onAdvance: (order: Order) => void;
  onAssignDeliverer: (order: Order, delivererId: string) => void;
  onRefund: (order: Order) => void;
};

export function OrderCard({ order, deliverers, onAdvance, onAssignDeliverer, onRefund }: OrderCardProps) {
  const selectable = deliverers.filter((deliverer) => deliverer.active || deliverer.id === order.delivererId);

  return (
    <div className="pedidos-card">
      <button type="button" className="pedidos-card__main" onClick={() => onAdvance(order)}>
        <strong>
          #{order.code} · {order.type}
        </strong>
        <span>{order.customerName ?? "Cliente não informado"}</span>
        <span>{order.items.map((item) => `${item.quantity}x ${item.productName}`).join(", ")}</span>
        <span>{formatCents(order.totalCents)}</span>
      </button>
      {order.type === "DELIVERY" && (
        <select value={order.delivererId ?? ""} onChange={(event) => onAssignDeliverer(order, event.target.value)} aria-label="Entregador">
          <option value="">Sem entregador</option>
          {selectable.map((deliverer) => (
            <option key={deliverer.id} value={deliverer.id}>
              {deliverer.name}
            </option>
          ))}
        </select>
      )}
      {order.payment?.status === "APROVADO" && (
        <button type="button" className="pedidos-card__refund" onClick={() => onRefund(order)}>
          Estornar pagamento
        </button>
      )}
    </div>
  );
}
