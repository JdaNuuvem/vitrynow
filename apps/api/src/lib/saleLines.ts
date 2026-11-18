// API-21 — definição ÚNICA de "venda" (relatórios) e de "dinheiro em caixa" (caixa), ADR-0012 rev.1 §7 (decisão PRD-09).
// Função pura: sem banco, sem relógio implícito. Relatório e caixa usam ESTA função; as duas projeções são distintas de propósito:
//  - VENDA (relatório): pedido em CONFIRMADO|EM_PREPARO|PRONTO|SAIU_PARA_ENTREGA|CONCLUIDO e fora de "aguardando pagamento online"; PENDENTE é "em aberto",
//    CANCELADO é à parte. Faturamento = total − gorjeta. Data = criação no fuso da loja (mesa: o instante do RECEBIMENTO). Pedido de mesa recebido vira
//    UMA venda por recebimento (nunca por pedido).
//  - DINHEIRO NA GAVETA (caixa): só dinheiro efetivamente RECEBIDO dentro da sessão (pedido: `paidAt`; mesa: `receivedAt`), mais suprimentos, menos
//    sangrias e devoluções. O troco é irrelevante para a gaveta (o valor que conta é o aplicado à conta, não o entregue pelo cliente).

export const SALE_STATUSES = ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"] as const;
const isSaleStatus = (status: string) => (SALE_STATUSES as readonly string[]).includes(status);

/** Este pedido é VENDA? (B14.1: status de venda e fora de "aguardando pagamento online"). O relatório e o caixa usam ESTA regra. */
export const isSale = (o: { status: string; awaitingPayment: boolean }) => isSaleStatus(o.status) && !o.awaitingPayment;
/** Faturamento do pedido = total − gorjeta (a gorjeta é do entregador, não da loja). */
export const saleRevenueCents = (o: { totalCents: number; tipCents: number }) => o.totalCents - o.tipCents;

export type SaleOrder = {
  id: string;
  type: "DELIVERY" | "BALCAO" | "MESA";
  status: string;
  awaitingPayment: boolean;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
  paymentMethod: "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO" | "VR" | "VA" | null;
  createdAt: Date;
  paidAt: Date | null;
  receiptId: string | null;
};
export type SaleReceipt = {
  id: string;
  receivedAt: Date;
  totalCents: number;
  serviceFeeCents: number;
  orderIds: string[];
  payments: { id: string; method: string; amountCents: number; changeForCents?: number }[];
};
export type SaleCashMovement = { type: "SUPRIMENTO" | "SANGRIA" | "DEVOLUCAO"; amountCents: number; createdAt: Date };

export type FinancialsInput = {
  orders: SaleOrder[];
  receipts: SaleReceipt[];
  movements: SaleCashMovement[];
  cashSession: { openedAt: Date; closedAt: Date | null; openingBalanceCents: number };
  range: { from: Date; to: Date };
  timeZone: string;
  now: Date;
};

type Bucket = { count: number; revenueCents: number };
export type SalesSummary = {
  count: number;
  revenueCents: number;
  tipCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  averageTicketCents: number;
  canceledCount: number;
  canceledCents: number;
  openCount: number;
  openCents: number;
  byType: Record<string, Bucket>;
  byPaymentMethod: Record<string, Bucket>;
  byDay: { date: string; count: number; revenueCents: number }[];
};
export type CashSummary = {
  expectedCents: number;
  receivedCashCents: number;
  entriesCents: number;
  exitsCents: number;
  refundsCents: number;
  toReceiveCount: number;
  toReceiveCents: number;
};

const add = (map: Record<string, Bucket>, key: string, revenueCents: number) => {
  const b = (map[key] ??= { count: 0, revenueCents: 0 });
  b.count += 1;
  b.revenueCents += revenueCents;
};

/** Data civil "YYYY-MM-DD" do instante no fuso informado. */
export function localDate(instant: Date, timeZone: string): string {
  return instant.toLocaleDateString("en-CA", { timeZone });
}

export function summarizeFinancials(input: FinancialsInput): { sales: SalesSummary; cash: CashSummary } {
  const { orders, receipts, movements, cashSession, range, timeZone, now } = input;

  // I4: o recebimento só existe com as formas de pagamento somando EXATAMENTE o total (nunca um recebimento torto).
  for (const r of receipts) {
    const sum = r.payments.reduce((a, p) => a + p.amountCents, 0);
    if (sum !== r.totalCents) throw new Error(`recebimento ${r.id}: as formas de pagamento somam ${sum} e o total é ${r.totalCents}`);
  }

  const inRange = (d: Date) => d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime();

  // ── relatório ──
  const sales: SalesSummary = {
    count: 0, revenueCents: 0, tipCents: 0, deliveryFeeCents: 0, discountCents: 0, averageTicketCents: 0,
    canceledCount: 0, canceledCents: 0, openCount: 0, openCents: 0, byType: {}, byPaymentMethod: {}, byDay: [],
  };
  const byDay = new Map<string, Bucket>();
  const sell = (type: string, date: Date, revenue: number) => {
    sales.count += 1;
    sales.revenueCents += revenue;
    add(sales.byType, type, revenue);
    const day = localDate(date, timeZone);
    const b = byDay.get(day) ?? { count: 0, revenueCents: 0 };
    b.count += 1;
    b.revenueCents += revenue;
    byDay.set(day, b);
  };
  for (const o of orders) {
    if (!inRange(o.createdAt)) continue;
    if (o.status === "CANCELADO") {
      sales.canceledCount += 1;
      sales.canceledCents += o.totalCents;
      continue;
    }
    if (o.status === "PENDENTE") {
      if (o.type !== "MESA") {
        sales.openCount += 1;
        sales.openCents += o.totalCents;
      }
      continue;
    }
    // pedido de mesa recebido (ou não) NUNCA é venda por pedido: a venda é o recebimento
    if (o.type === "MESA" || o.receiptId || o.awaitingPayment || !isSaleStatus(o.status)) continue;
    const revenue = o.totalCents - o.tipCents;
    sell(o.type, o.createdAt, revenue);
    sales.tipCents += o.tipCents;
    sales.deliveryFeeCents += o.deliveryFeeCents;
    sales.discountCents += o.discountCents;
    add(sales.byPaymentMethod, o.paymentMethod ?? "NAO_IDENTIFICADO", revenue);
  }
  for (const r of receipts) {
    if (!inRange(r.receivedAt)) continue;
    sell("MESA", r.receivedAt, r.totalCents);
    for (const p of r.payments) add(sales.byPaymentMethod, p.method, p.amountCents);
  }
  sales.averageTicketCents = sales.count > 0 ? Math.round(sales.revenueCents / sales.count) : 0;
  sales.byDay = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, b]) => ({ date, ...b }));

  // ── caixa ──
  const from = cashSession.openedAt.getTime();
  const to = (cashSession.closedAt ?? now).getTime();
  const inSession = (d: Date) => d.getTime() >= from && d.getTime() <= to;
  let receivedCashCents = 0;
  let toReceiveCount = 0;
  let toReceiveCents = 0;
  for (const o of orders) {
    if (o.paymentMethod !== "DINHEIRO" || o.type === "MESA" || o.receiptId || o.status === "CANCELADO") continue;
    if (o.paidAt) {
      if (inSession(o.paidAt)) receivedCashCents += o.totalCents;
    } else if (isSaleStatus(o.status) && !o.awaitingPayment && o.createdAt.getTime() <= to) {
      toReceiveCount += 1;
      toReceiveCents += o.totalCents;
    }
  }
  for (const r of receipts) {
    if (!inSession(r.receivedAt)) continue;
    for (const p of r.payments) if (p.method === "DINHEIRO") receivedCashCents += p.amountCents;
  }
  const sum = (type: SaleCashMovement["type"]) => movements.filter((m) => m.type === type && inSession(m.createdAt)).reduce((a, m) => a + m.amountCents, 0);
  const entriesCents = sum("SUPRIMENTO");
  const exitsCents = sum("SANGRIA");
  const refundsCents = sum("DEVOLUCAO");
  const cash: CashSummary = {
    expectedCents: cashSession.openingBalanceCents + receivedCashCents + entriesCents - exitsCents - refundsCents,
    receivedCashCents, entriesCents, exitsCents, refundsCents, toReceiveCount, toReceiveCents,
  };
  return { sales, cash };
}
