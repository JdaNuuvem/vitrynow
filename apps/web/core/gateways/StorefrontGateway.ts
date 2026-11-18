import type { HttpResult } from "../http/HttpClient";
import type { Menu, PaymentStatusResponse, PlaceOrderInput, PlacedOrderResponse } from "../domain/storefront";

// Rotas públicas da loja (sem login do painel): cardápio, pedido, cancelamento e pagamento.
export interface StorefrontGateway {
  getMenu(slug: string): Promise<HttpResult<Menu>>;
  placeOrder(slug: string, input: PlaceOrderInput): Promise<HttpResult<PlacedOrderResponse>>;
  // NG-16: as duas rotas exigem o token do pedido (cabeçalho x-order-token); sem ele a API responde 404.
  cancelOrder(slug: string, orderId: string, token: string): Promise<HttpResult<unknown>>;
  getPaymentStatus(slug: string, orderId: string, token: string): Promise<HttpResult<PaymentStatusResponse>>;
}
