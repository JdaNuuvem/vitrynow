import type { HttpResult, RequestOptions } from "../http/HttpClient";
import type { Deliverer, Order, OrderStatus } from "../domain/orders";

export interface OrdersGateway {
  list(): Promise<HttpResult<{ orders: Order[] }>>;
  setStatus(orderId: string, status: OrderStatus): Promise<HttpResult<unknown>>;
  assignDeliverer(orderId: string, delivererId: string | null): Promise<HttpResult<unknown>>;
  refund(orderId: string, options?: RequestOptions): Promise<HttpResult<unknown>>;
}

export interface DeliverersGateway {
  list(): Promise<HttpResult<{ deliverers: Deliverer[] }>>;
  create(input: { name: string; phone?: string }): Promise<HttpResult<unknown>>;
  setActive(id: string, active: boolean): Promise<HttpResult<unknown>>;
  remove(id: string): Promise<HttpResult<unknown>>;
}
