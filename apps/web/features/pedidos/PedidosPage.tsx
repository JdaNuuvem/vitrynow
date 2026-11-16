"use client";

import { STATUS_LABELS } from "@/core/domain/orderLabels";
import type { Order } from "@/core/domain/orders";
import { OrderCard } from "./components/OrderCard";
import { usePedidos } from "./hooks/usePedidos";
import { KANBAN_COLUMNS, ordersByStatus } from "./kanban";
import "./pedidos.css";

export function PedidosPage() {
  const { orders, deliverers, advance, assignDeliverer, refund } = usePedidos();

  async function confirmRefund(order: Order) {
    if (!confirm(`Estornar o pagamento PIX do pedido #${order.code}? Isso cancela o pedido.`)) return;
    const failure = await refund(order);
    if (failure) alert(failure);
  }

  return (
    <main className="pedidos">
      <h1>Pedidos</h1>
      <div className="pedidos__board">
        {KANBAN_COLUMNS.map((status) => (
          <section key={status} className="pedidos__column">
            <h2>{STATUS_LABELS[status]}</h2>
            <div className="pedidos__list">
              {ordersByStatus(orders, status).map((order) => (
                <OrderCard key={order.id} order={order} deliverers={deliverers} onAdvance={advance} onAssignDeliverer={assignDeliverer} onRefund={confirmRefund} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
