import type { HttpResult } from "../http/HttpClient";
import type { Menu, PaymentStatusResponse, PlaceOrderInput, PlacedOrderResponse } from "../domain/storefront";

// Rotas públicas da loja (sem login do painel): cardápio, pedido, cancelamento e pagamento.
export interface StorefrontGateway {
  getMenu(slug: string): Promise<HttpResult<Menu>>;
  placeOrder(slug: string, input: PlaceOrderInput): Promise<HttpResult<PlacedOrderResponse>>;
  cancelOrder(slug: string, orderId: string): Promise<HttpResult<unknown>>;
  getPaymentStatus(slug: string, orderId: string): Promise<HttpResult<PaymentStatusResponse>>;
}
