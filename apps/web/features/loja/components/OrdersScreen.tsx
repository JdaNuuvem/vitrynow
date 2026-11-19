import { formatCents } from "@/shared/format/money";
import type { ReadOrderTracking } from "@/core/gateways/StorefrontGateway";
import { PIX_PAID_REASSURANCE, TRACKING_UNAVAILABLE_MESSAGE } from "../hooks/useOrderFlow";
import type { PlacedOrder } from "../hooks/useOrderHistory";
import { storeChatLink } from "./OrderResultScreen";
import { OrderTrackingPanel } from "./OrderTrackingPanel";

// Pedidos feitos nesta sessão podem ser consultados. Depois de recarregar, sobra o comprovante local.
export function OrdersScreen({
  orders,
  storeName,
  whatsapp = null,
  pendingPix = null,
  trackingFor,
}: {
  orders: PlacedOrder[];
  storeName: string;
  whatsapp?: string | null;
  pendingPix?: { code: string; expiresAt: number } | null;
  trackingFor?: (order: PlacedOrder) => ReadOrderTracking | undefined;
}) {
  return (
    <div className="loja__orders">
      <h1 className="loja__orders-title">Meus pedidos</h1>
      {orders.length === 0 ? (
        <p className="loja__muted">Você ainda não fez pedidos em {storeName} neste aparelho.</p>
      ) : (
        <div className="loja__list">
          {orders.map((order) => {
            const read = trackingFor?.(order);
            const chatLink = storeChatLink(whatsapp, order.code);
            const pixStillValid = pendingPix !== null && pendingPix.code === order.code && Date.now() < pendingPix.expiresAt;
            return (
              <div key={order.code + order.placedAt} className="loja__order-row">
                <div>
                  <div className="loja__order-code">Pedido #{order.code}</div>
                  <div className="loja__order-date">{new Date(order.placedAt).toLocaleString("pt-BR")}</div>
                  {read ? <OrderTrackingPanel read={read} /> : <p className="loja__order-note">{TRACKING_UNAVAILABLE_MESSAGE}</p>}
                  {!read && pixStillValid && <p className="loja__order-note">{PIX_PAID_REASSURANCE}</p>}
                  {chatLink && (
                    <a href={chatLink} target="_blank" rel="noreferrer" className="loja__empty-menu-link">
                      Falar com a loja no WhatsApp
                    </a>
                  )}
                </div>
                {order.totalCents != null && <div className="loja__order-total">{formatCents(order.totalCents)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
