import type { OrderPaymentMethod, OrderType } from "@meucardapio/db";

export type CashSessionInput = {
  openingBalanceCents: number;
  movements: { type: "SUPRIMENTO" | "SANGRIA"; amountCents: number }[];
};

export type CashOrderInput = {
  type: OrderType;
  status: string;
  totalCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  paymentMethod: OrderPaymentMethod | null;
};

export type PaymentBucket = OrderPaymentMethod | "NAO_IDENTIFICADO";

export type CashSummary = {
  openingCents: number;
  cashSalesCents: number;
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

// Saldo esperado = abertura + vendas em dinheiro + suprimentos - sangrias. Vendas
// canceladas não entram em nenhum total (só são contadas à parte).
export function computeCashSummary(session: CashSessionInput, orders: CashOrderInput[]): CashSummary {
  const entriesCents = session.movements.filter((m) => m.type === "SUPRIMENTO").reduce((sum, m) => sum + m.amountCents, 0);
  const exitsCents = session.movements.filter((m) => m.type === "SANGRIA").reduce((sum, m) => sum + m.amountCents, 0);

  const byType: CashSummary["sales"]["byType"] = { MESA: emptyBucket(), DELIVERY: emptyBucket(), BALCAO: emptyBucket() };
  const byPaymentMethod: CashSummary["byPaymentMethod"] = {};
  const sales = { count: 0, revenueCents: 0, deliveryFeeCents: 0, tipCents: 0, canceledCount: 0, canceledCents: 0 };
  let cashSalesCents = 0;

  for (const order of orders) {
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

    const bucket: PaymentBucket = order.paymentMethod ?? "NAO_IDENTIFICADO";
    const entry = (byPaymentMethod[bucket] ??= emptyBucket());
    entry.count += 1;
    entry.revenueCents += order.totalCents;
    if (order.paymentMethod === "DINHEIRO") cashSalesCents += order.totalCents;
  }

  return {
    openingCents: session.openingBalanceCents,
    cashSalesCents,
    entriesCents,
    exitsCents,
    expectedCents: session.openingBalanceCents + cashSalesCents + entriesCents - exitsCents,
    sales: { byType, ...sales },
    byPaymentMethod,
  };
}
