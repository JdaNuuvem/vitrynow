"use client";

import { statusLabel } from "@/core/domain/orderLabels";
import type { Order } from "@/core/domain/orders";
import { OrderCard } from "./components/OrderCard";
import { usePedidos } from "./hooks/usePedidos";
import { KANBAN_COLUMNS, groupOrders } from "./kanban";
import "./pedidos.css";

export function PedidosPage() {
  const { orders, deliverers, advance, assignDeliverer, refund } = usePedidos();
  const groups = groupOrders(orders);

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
            <h2>{statusLabel(status)}</h2>
            <div className="pedidos__list">
              {groups.byStatus[status].map((order) => (
                <OrderCard key={order.id} order={order} deliverers={deliverers} onAdvance={advance} onAssignDeliverer={assignDeliverer} onRefund={confirmRefund} />
              ))}
            </div>
          </section>
        ))}
        {/* Coletor: pedido com status que esta tela ainda não conhece nunca some (contrato B3 §10). */}
        {groups.others.length > 0 && (
          <section className="pedidos__column" aria-label="Outros">
            <h2>Outros</h2>
            <p className="pedidos__column-hint">Pedidos com um status que esta tela ainda não conhece. Eles ficam aqui para você não perder nenhum.</p>
            <div className="pedidos__list">
              {groups.others.map((order) => (
                <OrderCard key={order.id} order={order} deliverers={deliverers} onAdvance={advance} onAssignDeliverer={assignDeliverer} onRefund={confirmRefund} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
