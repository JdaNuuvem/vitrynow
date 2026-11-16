import type { HttpResult } from "../http/HttpClient";
import type { Menu, PlaceOrderInput, PlacedOrderResponse } from "../domain/storefront";

// Rotas públicas da loja (sem login do painel): cardápio, pedido, cancelamento e pagamento.
export interface StorefrontGateway {
  getMenu(slug: string): Promise<HttpResult<Menu>>;
  placeOrder(slug: string, input: PlaceOrderInput): Promise<HttpResult<PlacedOrderResponse>>;
  cancelOrder(slug: string, orderId: string): Promise<HttpResult<unknown>>;
  isAwaitingPayment(slug: string, orderId: string): Promise<HttpResult<{ awaitingPayment: boolean }>>;
}
