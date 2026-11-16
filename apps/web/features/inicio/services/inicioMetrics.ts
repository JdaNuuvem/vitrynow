import type { ReportDay, ReportRange, ReportSummary, ReportTopProduct } from "@/core/domain/reports";

export const PLATFORM_FEE_RATE = 0.25;

export type DayPoint = { day: number; revenueCents: number };

export type InicioMetrics = {
  revenueCents: number;
  orderCount: number;
  customerCount: number;
  averageTicketCents: number;
  feeSavingsCents: number;
  week: { orderCount: number; revenueCents: number };
  orderTypes: { delivery: number; table: number; pickup: number };
  topProducts: ReportTopProduct[];
  monthSeries: DayPoint[];
};

export function monthRange(now: Date): ReportRange {
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
}

export function weekRange(now: Date): ReportRange {
  return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), to: now };
}

function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildMonthSeries(byDay: ReportDay[], now: Date): DayPoint[] {
  const revenueByKey = new Map(byDay.map((entry) => [entry.date, entry.revenueCents]));
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return { day, revenueCents: revenueByKey.get(dayKey(now.getFullYear(), now.getMonth(), day)) ?? 0 };
  });
}

export function buildInicioMetrics(month: ReportSummary, week: ReportSummary, now: Date): InicioMetrics {
  const countOf = (type: string) => month.byType[type]?.count ?? 0;
  return {
    revenueCents: month.revenueCents,
    orderCount: month.orderCount,
    customerCount: month.customerCount,
    averageTicketCents: month.averageTicketCents,
    feeSavingsCents: Math.round(month.revenueCents * PLATFORM_FEE_RATE),
    week: { orderCount: week.orderCount, revenueCents: week.revenueCents },
    orderTypes: { delivery: countOf("DELIVERY"), table: countOf("MESA"), pickup: countOf("BALCAO") },
    topProducts: month.topProducts,
    monthSeries: buildMonthSeries(month.byDay, now),
  };
}
