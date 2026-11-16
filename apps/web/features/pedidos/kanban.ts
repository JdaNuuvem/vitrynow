import type { Order, OrderStatus } from "@/core/domain/orders";

export const KANBAN_COLUMNS: readonly OrderStatus[] = ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"];

export function nextStatus(status: OrderStatus): OrderStatus | null {
  return KANBAN_COLUMNS[KANBAN_COLUMNS.indexOf(status) + 1] ?? null;
}

export function ordersByStatus(orders: Order[], status: OrderStatus): Order[] {
  return orders.filter((order) => order.status === status);
}
