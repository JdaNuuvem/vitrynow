import type { HttpResult, RequestOptions } from "../http/HttpClient";
import type { Deliverer, Order, OrderStatus } from "../domain/orders";

// Resposta de cancelar/estornar (contrato B3 §2.2): `refund` só vem quando havia dinheiro online.
// "DONE" = estorno aceito e pedido cancelado; "PENDING" (HTTP 202) = estorno ainda não aceito, o pedido NÃO mudou.
export type CancelResult = { order: Order; refund?: "DONE" | "PENDING" };

export type CancelBody = {
  reason: { code: string; text?: string; customerMessage?: string };
  acknowledgeClosedCash?: boolean;
};

export interface OrdersGateway {
  list(): Promise<HttpResult<{ orders: Order[] }>>;
  // Rotas novas do contrato B3 (API-02). As legadas /status e /refund deixam de ser usadas pela tela.
  transition(orderId: string, to: OrderStatus): Promise<HttpResult<{ order: Order }>>;
  cancel(orderId: string, body: CancelBody, options?: RequestOptions): Promise<HttpResult<CancelResult>>;
  undo(orderId: string): Promise<HttpResult<{ order: Order }>>;
  retryRefund(orderId: string, options?: RequestOptions): Promise<HttpResult<CancelResult>>;
  assignDeliverer(orderId: string, delivererId: string | null): Promise<HttpResult<unknown>>;
}

export interface DeliverersGateway {
  list(): Promise<HttpResult<{ deliverers: Deliverer[] }>>;
  create(input: { name: string; phone?: string }): Promise<HttpResult<unknown>>;
  setActive(id: string, active: boolean): Promise<HttpResult<unknown>>;
  remove(id: string): Promise<HttpResult<unknown>>;
}
