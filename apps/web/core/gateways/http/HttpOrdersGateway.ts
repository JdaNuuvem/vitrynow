import type { HttpClient, RequestOptions } from "../../http/HttpClient";
import type { DeliverersGateway, OrdersGateway } from "../OrdersGateway";
import type { Deliverer, Order, OrderStatus } from "../../domain/orders";

export class HttpOrdersGateway implements OrdersGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<{ orders: Order[] }>("/api/orders");
  }

  setStatus(orderId: string, status: OrderStatus) {
    return this.http.post(`/api/orders/${orderId}/status`, { status });
  }

  assignDeliverer(orderId: string, delivererId: string | null) {
    return this.http.post(`/api/orders/${orderId}/deliverer`, { delivererId });
  }

  refund(orderId: string, options?: RequestOptions) {
    return this.http.post(`/api/orders/${orderId}/refund`, undefined, options);
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
