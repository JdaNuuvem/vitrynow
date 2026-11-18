import type { Order } from "@/core/domain/orders";
import type { ReportDay, ReportRange, ReportSummary, ReportTopProduct } from "@/core/domain/reports";
import { applySaleDefinition, awaitingInRange } from "./salesDefinition";

export type DayPoint = { day: number; revenueCents: number };

export type InicioMetrics = {
  // Faturamento e vendas pela definição única do B14.1 (ver salesDefinition.ts): sem gorjeta, sem "Aguardando aceite".
  revenueCents: number;
  tipCents: number;
  awaiting: { count: number; cents: number };
  awaitingKnown: boolean;
  chartExact: boolean;
  orderCount: number;
  customerCount: number;
  averageTicketCents: number;
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

// `orders` = lista de pedidos do painel (para separar o "Aguardando aceite"); null se não carregou.
export function buildInicioMetrics(month: ReportSummary, week: ReportSummary, now: Date, orders: Order[] | null = null): InicioMetrics {
  const monthAwaiting = orders && awaitingInRange(orders, monthRange(now));
  const monthSales = applySaleDefinition(month, monthAwaiting);
  const weekSales = applySaleDefinition(week, orders && awaitingInRange(orders, weekRange(now)));
  // Por tipo, só vendas: o "Aguardando aceite" sai da contagem como saiu do total.
  const countOf = (type: string) => Math.max(0, (month.byType[type]?.count ?? 0) - (monthAwaiting?.filter((order) => order.type === type).length ?? 0));
  return {
    revenueCents: monthSales.revenueCents,
    tipCents: monthSales.tipCents,
    awaiting: monthSales.awaiting,
    awaitingKnown: monthSales.awaitingKnown,
    chartExact: monthSales.chartExact,
    orderCount: monthSales.salesCount,
    customerCount: month.customerCount,
    averageTicketCents: monthSales.averageTicketCents,
    week: { orderCount: weekSales.salesCount, revenueCents: weekSales.revenueCents },
    orderTypes: { delivery: countOf("DELIVERY"), table: countOf("MESA"), pickup: countOf("BALCAO") },
    topProducts: month.topProducts,
    monthSeries: buildMonthSeries(monthSales.byDay, now),
  };
}
