export type ReportByType = Record<string, { count: number; revenueCents: number }>;

export type ReportTopProduct = { productName: string; quantity: number; revenueCents: number };

export type ReportDay = { date: string; orderCount: number; revenueCents: number };

export type ReportSummary = {
  from: string;
  to: string;
  orderCount: number;
  revenueCents: number;
  discountCents: number;
  // A API já manda a gorjeta e a taxa de entrega somadas no período; o total (`revenueCents`) as inclui.
  tipCents?: number;
  deliveryFeeCents?: number;
  averageTicketCents: number;
  customerCount: number;
  byDay: ReportDay[];
  byType: ReportByType;
  topProducts: ReportTopProduct[];
  byDeliverer: ReportByDeliverer[];
  cashSummary: ReportCashSummary;
};

export type ReportRange = { from: Date; to: Date };

export type ReportByDeliverer = { delivererName: string; orderCount: number; revenueCents: number };

export type ReportCashSummary = { sessionCount: number; suprimentosCents: number; sangriasCents: number };
