import { ORDER_STATUSES, type Order, type OrderStatus } from "@/core/domain/orders";

// Colunas do quadro, na ordem da tela. SAIU_PARA_ENTREGA tem coluna própria (contrato B3 §10).
// SSOT D3: a ordem de vida do pedido vem da lista única; só CANCELADO fica fora do quadro.
export const KANBAN_COLUMNS: readonly OrderStatus[] = ORDER_STATUSES.filter((status) => status !== "CANCELADO");

// Status que SAEM do quadro de propósito: pedido cancelado vai para histórico/busca, não para o kanban.
// É a única exceção à regra "nenhum pedido some"; qualquer outro valor cai em "Outros".
export const OFF_BOARD_STATUSES: readonly string[] = ["CANCELADO"];

// O fluxo de avanço NÃO fica mais aqui: com a API-02 cada botão vem de `allowedTransitions` calculado
// no servidor (WEB-05), então o quadro só decide ONDE o pedido aparece, nunca o próximo passo.

export function ordersByStatus(orders: Order[], status: OrderStatus): Order[] {
  return orders.filter((order) => order.status === status);
}

// Ordem dentro da coluna (RN-KB-04, Leonardo): quem espera há mais tempo fica no TOPO. Novos, Em preparo, Prontos e Em
// entrega: o mais ANTIGO primeiro. Concluídos: o mais RECENTE primeiro (é histórico do dia). A API devolve `createdAt`
// decrescente e a tela não reordenava: o pedido vermelho (há mais tempo em Novos) ficava no fim da coluna.
// Hora de referência = quando entrou no estado atual (`statusChangedAt`); sem ela, `createdAt`. Pedido sem nenhuma das
// duas vai para o fim e mantém a ordem em que chegou (nunca embaralha).
const NEWEST_FIRST: readonly string[] = ["CONCLUIDO"];

function enteredStateAt(order: Order): number | null {
  const reference = order.statusChangedAt ?? order.createdAt;
  const time = reference ? Date.parse(reference) : Number.NaN;
  return Number.isNaN(time) ? null : time;
}

export function sortForColumn(orders: Order[], status: string): Order[] {
  const newestFirst = NEWEST_FIRST.includes(status);
  // `sort` do JS é estável: empate ou sem hora conserva a ordem de chegada
  return [...orders].sort((a, b) => {
    const [x, y] = [enteredStateAt(a), enteredStateAt(b)];
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return newestFirst ? y - x : x - y;
  });
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
  for (const status of KANBAN_COLUMNS) byStatus[status] = sortForColumn(byStatus[status], status);
  return { byStatus, others: sortForColumn(others, "OUTROS") };
}
