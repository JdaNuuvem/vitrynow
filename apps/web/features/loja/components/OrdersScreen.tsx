import { formatCents } from "@/shared/format/money";
import type { PlacedOrder } from "../hooks/useOrderHistory";

export function OrdersScreen({ orders, storeName }: { orders: PlacedOrder[]; storeName: string }) {
  return (
    <div className="loja__orders">
      <h1 className="loja__orders-title">Meus pedidos</h1>
      {orders.length === 0 ? (
        <p className="loja__muted">Você ainda não fez pedidos em {storeName} neste aparelho.</p>
      ) : (
        <div className="loja__list">
          {orders.map((order) => (
            <div key={order.code + order.placedAt} className="loja__order-row">
              <div>
                <div className="loja__order-code">Pedido #{order.code}</div>
                <div className="loja__order-date">{new Date(order.placedAt).toLocaleString("pt-BR")}</div>
              </div>
              <div className="loja__order-total">{formatCents(order.totalCents)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
