import type { ReportDay, ReportRange, ReportSummary, ReportTopProduct } from "@/core/domain/reports";
import type { Order } from "@/core/domain/orders";
import { applySaleDefinition, awaitingInRange } from "./salesDefinition";
import { toDateInput, toReportRange } from "@/features/relatorios/dateRange";

export type DayPoint = { date: string; orderCount: number | null; revenueCents: number | null };

export type InicioMetrics = {
  revenueCents?: number;
  tipCents?: number;
  awaiting: { count: number; cents?: number };
  awaitingKnown: boolean;
  chartExact: boolean;
  orderCount: number;
  customerCount: number;
  averageTicketCents?: number;
  week: { orderCount: number; revenueCents?: number };
  orderTypes: { delivery: number; table: number; pickup: number };
  topProducts: ReportTopProduct[];
  monthSeries: DayPoint[];
};

export function monthRange(now: Date): ReportRange {
  const today = toDateInput(now);
  return toReportRange({ from: today.slice(0, 8) + "01", to: today });
}

export function weekRange(now: Date): ReportRange {
  return toReportRange({ from: toDateInput(new Date(now.getTime() - 6 * 86_400_000)), to: toDateInput(now) });
}

export function buildMonthSeries(byDay: ReportDay[], now: Date): DayPoint[] {
  // The API groups by the São Paulo calendar, independently of the operator's device.
  const today = toDateInput(now);
  const points = new Map<string, DayPoint>(byDay.map((entry) => [entry.date, { ...entry, revenueCents: entry.revenueCents ?? null }]));
  for (let day = 1; day <= Number(today.slice(8)); day += 1) {
    const date = today.slice(0, 8) + String(day).padStart(2, "0");
    if (!points.has(date)) points.set(date, { date, orderCount: null, revenueCents: null });
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildPeriodMetrics(summary: ReportSummary, range: ReportRange, orders: Order[] | null) {
  const current = summary.openCount !== undefined || summary.ruleChangedAt !== undefined;
  const awaiting = !current && orders ? awaitingInRange(orders, range) : null;
  const legacy = !current && summary.revenueCents !== undefined
    ? applySaleDefinition({ ...summary, revenueCents: summary.revenueCents }, awaiting)
    : undefined;
  const countOf = (type: string) => Math.max(0, (summary.byType[type]?.count ?? 0) - (legacy && awaiting ? awaiting.filter((order) => order.type === type).length : 0));
  return {
    revenueCents: legacy?.revenueCents ?? summary.revenueCents,
    tipCents: legacy?.tipCents ?? summary.tipCents,
    orderCount: legacy?.salesCount ?? summary.orderCount,
    averageTicketCents: legacy?.averageTicketCents ?? summary.averageTicketCents,
    awaiting: legacy?.awaiting ?? { count: summary.openCount ?? 0, cents: summary.openCents },
    awaitingKnown: legacy?.awaitingKnown ?? (summary.openCount !== undefined),
    chartExact: legacy?.chartExact ?? true,
    byDay: legacy?.byDay ?? summary.byDay,
    orderTypes: { delivery: countOf("DELIVERY"), table: countOf("MESA"), pickup: countOf("BALCAO") },
  };
}

export function buildInicioMetrics(month: ReportSummary, week: ReportSummary, now: Date, orders: Order[] | null = null): InicioMetrics {
  const monthSales = buildPeriodMetrics(month, monthRange(now), orders);
  const weekSales = buildPeriodMetrics(week, weekRange(now), orders);
  return {
    ...monthSales,
    customerCount: month.customerCount,
    week: { orderCount: weekSales.orderCount, revenueCents: weekSales.revenueCents },
    topProducts: month.topProducts,
    monthSeries: buildMonthSeries(monthSales.byDay, now),
  };
}
