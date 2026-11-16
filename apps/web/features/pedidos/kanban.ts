import type { Order, OrderStatus } from "@/core/domain/orders";

// Colunas do quadro, na ordem da tela. SAIU_PARA_ENTREGA tem coluna própria (contrato B3 §10).
export const KANBAN_COLUMNS: readonly OrderStatus[] = ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"];

// Status que SAEM do quadro de propósito: pedido cancelado vai para histórico/busca, não para o kanban.
// É a única exceção à regra "nenhum pedido some"; qualquer outro valor cai em "Outros".
export const OFF_BOARD_STATUSES: readonly string[] = ["CANCELADO"];

// Fluxo do clique que avança o pedido HOJE (rota legada /status). Separado de KANBAN_COLUMNS de
// propósito: a API em uso ainda recusa SAIU_PARA_ENTREGA, então o clique não pode levar para lá.
// Com a API-02 os botões passam a vir de `allowedTransitions` (WEB-05) e este fluxo some.
const LEGACY_FLOW: readonly OrderStatus[] = ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"];

export function nextStatus(status: OrderStatus): OrderStatus | null {
  const index = LEGACY_FLOW.indexOf(status);
  if (index === -1) return null;
  return LEGACY_FLOW[index + 1] ?? null;
}

export function ordersByStatus(orders: Order[], status: OrderStatus): Order[] {
  return orders.filter((order) => order.status === status);
}

export type BoardGroups = {
  byStatus: Record<string, Order[]>;
  // Coletor genérico: pedido cujo status nenhuma coluna conhece (a API ganhou um valor antes da tela).
  others: Order[];
};

// Cada pedido cai em exatamente UMA coluna, ou em "Outros", ou (só CANCELADO) fica fora de propósito.
// A regra é por exclusão: o que não é coluna conhecida nem está na lista de fora vai para Outros, então
// um valor novo de enum nunca faz o pedido desaparecer.
export function groupOrders(orders: Order[]): BoardGroups {
  const byStatus: Record<string, Order[]> = Object.fromEntries(KANBAN_COLUMNS.map((status) => [status, [] as Order[]]));
  const others: Order[] = [];
  for (const order of orders) {
    const status = order.status as string;
    if (KANBAN_COLUMNS.includes(status as OrderStatus)) byStatus[status].push(order);
    else if (!OFF_BOARD_STATUSES.includes(status)) others.push(order);
  }
  return { byStatus, others };
}
