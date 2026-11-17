import type { Order, OrderStatus } from "@/core/domain/orders";

// Colunas do quadro, na ordem da tela. SAIU_PARA_ENTREGA tem coluna própria (contrato B3 §10).
export const KANBAN_COLUMNS: readonly OrderStatus[] = ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"];

// Status que SAEM do quadro de propósito: pedido cancelado vai para histórico/busca, não para o kanban.
// É a única exceção à regra "nenhum pedido some"; qualquer outro valor cai em "Outros".
export const OFF_BOARD_STATUSES: readonly string[] = ["CANCELADO"];

// O fluxo de avanço NÃO fica mais aqui: com a API-02 cada botão vem de `allowedTransitions` calculado
// no servidor (WEB-05), então o quadro só decide ONDE o pedido aparece, nunca o próximo passo.

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
