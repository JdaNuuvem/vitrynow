import type { Order, OrderStatus } from "@/core/domain/orders";

import { FINAL_ORDER_STATUSES } from "@/core/domain/orders";

const FINISHED: readonly OrderStatus[] = FINAL_ORDER_STATUSES; // SSOT D3

export function selectCurrentOrders(orders: Order[]): Order[] {
  return orders.filter((order) => !FINISHED.includes(order.status));
}
