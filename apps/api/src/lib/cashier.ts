import type { OrderPaymentMethod, OrderType } from "@meucardapio/db";
import { summarizeFinancials } from "./saleLines";

export type CashSessionInput = {
  openedAt: Date;
  closedAt: Date | null;
  openingBalanceCents: number;
  movements: { type: "SUPRIMENTO" | "SANGRIA" | "DEVOLUCAO"; amountCents: number; createdAt?: Date }[];
};

export type CashOrderInput = {
  type: OrderType;
  status: string;
  totalCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  paymentMethod: OrderPaymentMethod | null;
  createdAt: Date;
  paidAt: Date | null; // quando o dinheiro foi RECEBIDO (RN-CX-01); o caixa só conta dinheiro daqui
  awaitingPayment: boolean;
};

export type PaymentBucket = OrderPaymentMethod | "NAO_IDENTIFICADO" | "SEM_COBRANCA";

export type CashSummary = {
  openingCents: number;
  cashSalesCents: number; // dinheiro RECEBIDO na sessão (não o "vendido em dinheiro")
  toReceiveCount: number; // dinheiro de pedido em andamento, ainda não recebido (informativo; não entra no esperado)
  toReceiveCents: number;
  entriesCents: number;
  exitsCents: number;
  expectedCents: number;
  sales: {
    byType: Record<OrderType, { count: number; revenueCents: number }>;
    count: number;
    revenueCents: number;
    deliveryFeeCents: number;
    tipCents: number;
    canceledCount: number;
    canceledCents: number;
  };
  byPaymentMethod: Partial<Record<PaymentBucket, { count: number; revenueCents: number }>>;
};

const emptyBucket = () => ({ count: 0, revenueCents: 0 });

// Saldo esperado = abertura + dinheiro RECEBIDO na sessão + suprimentos - sangrias - devoluções (RN-CX-01..06; a conta do dinheiro vem de
// `saleLines.summarizeFinancials`, a mesma definição que o relatório usa). Vendas canceladas não entram em nenhum total (só contadas à parte).
export function computeCashSummary(session: CashSessionInput, orders: CashOrderInput[], now: Date = new Date()): CashSummary {
  const financials = summarizeFinancials({
    orders: orders.map((o) => ({ id: "", type: o.type, status: o.status, awaitingPayment: o.awaitingPayment, subtotalCents: o.totalCents, discountCents: 0, deliveryFeeCents: o.deliveryFeeCents, tipCents: o.tipCents, totalCents: o.totalCents, paymentMethod: o.paymentMethod, createdAt: o.createdAt, paidAt: o.paidAt, receiptId: null })),
    receipts: [],
    movements: session.movements.map((m) => ({ ...m, createdAt: m.createdAt ?? session.openedAt })),
    cashSession: { openedAt: session.openedAt, closedAt: session.closedAt, openingBalanceCents: session.openingBalanceCents },
    range: { from: session.openedAt, to: session.closedAt ?? now },
    timeZone: "America/Sao_Paulo",
    now,
  }).cash;
  const windowEnd = (session.closedAt ?? now).getTime();
  const entriesCents = session.movements.filter((m) => m.type === "SUPRIMENTO").reduce((sum, m) => sum + m.amountCents, 0);
  // DEVOLUCAO (ao cliente, de pedido de caixa já fechado; só o sistema cria) reduz o esperado como uma saída (RN-CX-14).
  const exitsCents = session.movements.filter((m) => m.type === "SANGRIA" || m.type === "DEVOLUCAO").reduce((sum, m) => sum + m.amountCents, 0);

  const byType: CashSummary["sales"]["byType"] = { MESA: emptyBucket(), DELIVERY: emptyBucket(), BALCAO: emptyBucket() };
  const byPaymentMethod: CashSummary["byPaymentMethod"] = {};
  const sales = { count: 0, revenueCents: 0, deliveryFeeCents: 0, tipCents: 0, canceledCount: 0, canceledCents: 0 };

  for (const order of orders) {
    // O resumo de vendas é do TURNO (criados na sessão); pedido criado antes mas recebido na sessão só entra no dinheiro (acima).
    if (order.createdAt.getTime() < session.openedAt.getTime() || order.createdAt.getTime() > windowEnd) continue;
    if (order.status === "CANCELADO") {
      sales.canceledCount += 1;
      sales.canceledCents += order.totalCents;
      continue;
    }
    sales.count += 1;
    sales.revenueCents += order.totalCents;
    sales.deliveryFeeCents += order.deliveryFeeCents;
    sales.tipCents += order.tipCents;
    byType[order.type].count += 1;
    byType[order.type].revenueCents += order.totalCents;

    // Total zero (cupom cobriu tudo): "Sem cobrança", sem efeito no dinheiro do caixa (RN-CP-13).
    const bucket: PaymentBucket = order.totalCents === 0 ? "SEM_COBRANCA" : (order.paymentMethod ?? "NAO_IDENTIFICADO");
    const entry = (byPaymentMethod[bucket] ??= emptyBucket());
    entry.count += 1;
    entry.revenueCents += order.totalCents;
  }

  return {
    openingCents: session.openingBalanceCents,
    cashSalesCents: financials.receivedCashCents,
    toReceiveCount: financials.toReceiveCount,
    toReceiveCents: financials.toReceiveCents,
    entriesCents,
    exitsCents,
    expectedCents: financials.expectedCents,
    sales: { byType, ...sales },
    byPaymentMethod,
  };
}
