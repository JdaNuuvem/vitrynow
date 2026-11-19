import type { Order } from "@/core/domain/orders";
import type { ReportDay, ReportSummary } from "@/core/domain/reports";

// Definição única de venda (B14.1, Leonardo): venda = pedido CONFIRMADO ou além, que não aguarda pagamento.
// PENDENTE é "Aguardando aceite" e fica à parte; cancelado fica fora; gorjeta NÃO é receita da loja.
// Faturamento = total do pedido − gorjeta. Ticket médio = faturamento ÷ vendas.
//
// Compatibilidade com respostas anteriores à API-21, que incluíam gorjeta e PENDENTE no total.
// O adaptador de período usa diretamente os totais já calculados pelo servidor nas versões recentes.

export const STORE_TIMEZONE = "America/Sao_Paulo";

export type SalesFigures = {
  salesCount: number;
  revenueCents: number;
  tipCents: number;
  averageTicketCents: number;
  awaiting: { count: number; cents: number };
  byDay: ReportDay[];
  // A API não manda a gorjeta por dia: com gorjeta nas vendas, o gráfico ainda a inclui e a tela avisa.
  chartExact: boolean;
  // Sem a lista de pedidos não dá para separar o "Aguardando aceite": o número pode incluí-lo e a tela avisa.
  awaitingKnown: boolean;
};

type SummaryTotals = Pick<ReportSummary, "orderCount" | "byDay"> & { revenueCents: number; tipCents?: number };

const tipOf = (order: Order) => order.tipCents ?? 0;
const dayOf = (createdAt: string) => new Date(createdAt).toLocaleDateString("en-CA", { timeZone: STORE_TIMEZONE });

export const isAwaitingAccept = (order: Order) => order.status === "PENDENTE" && !order.awaitingPayment;

// Pedidos aguardando aceite criados no período, no mesmo recorte que a API usa (de `from` até o fim do dia `to`).
export function awaitingInRange(orders: Order[], range: { from: Date; to: Date }): Order[] {
  const start = range.from.getTime();
  const end = range.to.getTime() + 24 * 60 * 60 * 1000;
  return orders.filter((order) => {
    if (!isAwaitingAccept(order) || !order.createdAt) return false;
    const at = new Date(order.createdAt).getTime();
    return at >= start && at < end;
  });
}

// `awaiting` null = lista de pedidos indisponível: devolve o que a API mandou, menos a gorjeta, e marca `awaitingKnown: false`.
export function applySaleDefinition(summary: SummaryTotals, awaiting: Order[] | null): SalesFigures {
  const apiTip = summary.tipCents ?? 0;
  const pending = awaiting ?? [];
  const pendingTip = pending.reduce((sum, order) => sum + tipOf(order), 0);
  const pendingCents = pending.reduce((sum, order) => sum + order.totalCents - tipOf(order), 0);

  const salesCount = Math.max(0, summary.orderCount - pending.length);
  const salesTip = Math.max(0, apiTip - pendingTip);
  const revenueCents = Math.max(0, summary.revenueCents - apiTip - pendingCents);

  const byDay = summary.byDay.map((entry) => {
    const ofDay = pending.filter((order) => order.createdAt && dayOf(order.createdAt) === entry.date);
    return {
      ...entry,
      orderCount: Math.max(0, entry.orderCount - ofDay.length),
      revenueCents: entry.revenueCents === undefined ? undefined : Math.max(0, entry.revenueCents - ofDay.reduce((sum, order) => sum + order.totalCents, 0)),
    };
  });

  return {
    salesCount,
    revenueCents,
    tipCents: salesTip,
    averageTicketCents: salesCount > 0 ? Math.round(revenueCents / salesCount) : 0,
    awaiting: { count: pending.length, cents: pendingCents },
    byDay,
    chartExact: salesTip === 0,
    awaitingKnown: awaiting !== null,
  };
}
