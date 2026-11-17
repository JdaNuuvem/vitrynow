import type { HttpClient, RequestOptions } from "../../http/HttpClient";
import type { CancelBody, CancelResult, DeliverersGateway, OrdersGateway, OrdersListResponse } from "../OrdersGateway";
import type { Deliverer, Order, OrderStatus } from "../../domain/orders";

export class HttpOrdersGateway implements OrdersGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<OrdersListResponse>("/api/orders");
  }

  transition(orderId: string, to: OrderStatus) {
    return this.http.post<{ order: Order }>(`/api/orders/${orderId}/transition`, { to });
  }

  cancel(orderId: string, body: CancelBody, options?: RequestOptions) {
    return this.http.post<CancelResult>(`/api/orders/${orderId}/cancel`, body, options);
  }

  undo(orderId: string) {
    return this.http.post<{ order: Order }>(`/api/orders/${orderId}/undo`);
  }

  retryRefund(orderId: string, options?: RequestOptions) {
    return this.http.post<CancelResult>(`/api/orders/${orderId}/refund/retry`, undefined, options);
  }

  assignDeliverer(orderId: string, delivererId: string | null) {
    return this.http.post(`/api/orders/${orderId}/deliverer`, { delivererId });
  }

}

export class HttpDeliverersGateway implements DeliverersGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<{ deliverers: Deliverer[] }>("/api/deliverers");
  }

  create(input: { name: string; phone?: string }) {
    return this.http.post("/api/deliverers", input);
  }

  setActive(id: string, active: boolean) {
    return this.http.post(`/api/deliverers/${id}`, { active });
  }

  remove(id: string) {
    return this.http.post(`/api/deliverers/${id}/delete`);
  }
}
