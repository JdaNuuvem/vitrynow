import type { Order, OrderStatus } from "@/core/domain/orders";

const FINISHED: readonly OrderStatus[] = ["CONCLUIDO", "CANCELADO"];

export function selectCurrentOrders(orders: Order[]): Order[] {
  return orders.filter((order) => !FINISHED.includes(order.status));
}
