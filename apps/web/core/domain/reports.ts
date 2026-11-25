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

// API-45 (PRO, só o dono): GET /api/reports/advanced. Mesma definição de venda do resumo, no fuso da loja.
export type ReportDelta = { current: number; previous: number; changePercent: number | null };
export type AdvancedReport = {
  fromDate: string;
  toDate: string;
  timeZone: string;
  comparison: {
    previous: { fromDate: string; toDate: string };
    revenueCents: ReportDelta;
    orderCount: ReportDelta;
    averageTicketCents: ReportDelta;
    canceledCount: ReportDelta;
  };
  byHour: { hour: number; orderCount: number; revenueCents: number }[];
  byWeekday: { weekday: number; orderCount: number; revenueCents: number }[]; // 1 = segunda ... 7 = domingo
  byStaff: { userId: string; email: string; acceptedOrders: number; acceptedRevenueCents: number; tablesReceived: number; tablesRevenueCents: number }[];
  customers: {
    identified: number; new: number; returning: number; returningPercent: number | null;
    boughtTwiceOrMoreInPeriod: number; newRevenueCents: number; returningRevenueCents: number;
  };
};
