import type { HttpResult } from "../http/HttpClient";
import type { DeliveryZones, Menu, OrderTracking, PaymentStatusResponse, PlaceOrderInput, PlacedOrderResponse } from "../domain/storefront";

export type ReadOrderTracking = () => Promise<HttpResult<OrderTracking>>;

// Rotas públicas da loja (sem login do painel): cardápio, pedido, cancelamento e pagamento.
export interface StorefrontGateway {
  getMenu(slug: string): Promise<HttpResult<Menu>>;
  getOrderTracking?(slug: string, orderId: string, token: string): Promise<HttpResult<OrderTracking>>;
  getDeliveryZones?(slug: string): Promise<HttpResult<DeliveryZones>>;
  placeOrder(slug: string, input: PlaceOrderInput): Promise<HttpResult<PlacedOrderResponse>>;
  // NG-16: as duas rotas exigem o token do pedido (cabeçalho x-order-token); sem ele a API responde 404.
  cancelOrder(slug: string, orderId: string, token: string): Promise<HttpResult<unknown>>;
  getPaymentStatus(slug: string, orderId: string, token: string): Promise<HttpResult<PaymentStatusResponse>>;
}
