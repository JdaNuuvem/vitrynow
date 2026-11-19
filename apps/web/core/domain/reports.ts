export type ReportByType = Record<string, { count: number; revenueCents?: number }>;

export type ReportTopProduct = { productName: string; quantity: number; revenueCents?: number };

export type ReportDay = { date: string; orderCount: number; revenueCents?: number };

export type ReportSummary = {
  from: string;
  to: string;
  orderCount: number;
  // O relatório do funcionário omite valores monetários. Zero é um valor financeiro válido para o dono.
  revenueCents?: number;
  discountCents?: number;
  tipCents?: number;
  deliveryFeeCents?: number;
  averageTicketCents?: number;
  openCount?: number;
  openCents?: number;
  canceledCount?: number;
  canceledCents?: number;
  ruleChangedAt?: string;
  customerCount: number;
  byDay: ReportDay[];
  byType: ReportByType;
  byPaymentMethod?: ReportByType;
  topProducts: ReportTopProduct[];
  byDeliverer: ReportByDeliverer[];
  cashSummary?: ReportCashSummary;
};

export type ReportRange = { from: Date; to: Date };

export type ReportByDeliverer = { delivererName: string; orderCount: number; revenueCents?: number };

export type ReportCashSummary = { sessionCount: number; suprimentosCents: number; sangriasCents: number };
