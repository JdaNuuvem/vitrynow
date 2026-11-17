import type { HttpClient, RequestOptions } from "../../http/HttpClient";
import type { CancelBody, CancelResult, DeliverersGateway, OrdersGateway, OrdersListResponse } from "../OrdersGateway";
import type { Deliverer, Order, OrderStatus } from "../../domain/orders";
import type { HistoryQuery, HistoryResponse } from "../../domain/orderHistory";
import type { OrderDetail } from "../../domain/orderDetail";

export class HttpOrdersGateway implements OrdersGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<OrdersListResponse>("/api/orders");
  }

  history(query: HistoryQuery) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const text = params.toString();
    return this.http.get<HistoryResponse>(`/api/orders/history${text ? `?${text}` : ""}`);
  }

  get(orderId: string) {
    return this.http.get<{ order: OrderDetail }>(`/api/orders/${encodeURIComponent(orderId)}`);
  }

  transition(orderId: string, to: OrderStatus) {
    return this.http.post<{ order: Order }>(`/api/orders/${encodeURIComponent(orderId)}/transition`, { to });
  }

  cancel(orderId: string, body: CancelBody, options?: RequestOptions) {
    return this.http.post<CancelResult>(`/api/orders/${encodeURIComponent(orderId)}/cancel`, body, options);
  }

  undo(orderId: string) {
    return this.http.post<{ order: Order }>(`/api/orders/${encodeURIComponent(orderId)}/undo`);
  }

  retryRefund(orderId: string, options?: RequestOptions) {
    return this.http.post<CancelResult>(`/api/orders/${encodeURIComponent(orderId)}/refund/retry`, undefined, options);
  }

  assignDeliverer(orderId: string, delivererId: string | null) {
    return this.http.post(`/api/orders/${encodeURIComponent(orderId)}/deliverer`, { delivererId });
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
    return this.http.post(`/api/deliverers/${encodeURIComponent(id)}`, { active });
  }

  remove(id: string) {
    return this.http.post(`/api/deliverers/${encodeURIComponent(id)}/delete`);
  }
}
