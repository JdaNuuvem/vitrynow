// DADOS-1 / i3 (M13): comparativo com o período anterior, calculado AQUI e só aqui (o navegador não calcula indicador).
// delta = atual − anterior; % só quando o anterior é maior que zero (anterior zero ⇒ `isNew`, sem %); % arredondado a 1 casa.
import type { Report } from "./reports";
import type { ReportPeriod } from "./reportPeriod";

export type Delta = { current: number; previous: number; delta: number; percent: number | null; isNew: boolean };

export function delta(current: number, previous: number): Delta {
  return {
    current,
    previous,
    delta: current - previous,
    percent: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
    isNew: previous === 0 && current > 0,
  };
}

export type Comparison = {
  previous: { fromDate: string; toDate: string; from: string; to: string; timeZone: string; partial: boolean };
  orderCount: Delta;
  revenueCents?: Delta; // valores em reais só para o OWNER (RN-R-06)
  averageTicketCents?: Delta;
  discountCents?: Delta;
};

export function buildComparison(current: Report, previous: Report, previousPeriod: ReportPeriod, role: "OWNER" | "STAFF"): Comparison {
  const base: Comparison = {
    previous: {
      fromDate: previousPeriod.fromDate,
      toDate: previousPeriod.toDate,
      from: previousPeriod.fromUtc.toISOString(),
      to: previousPeriod.toExclusiveUtc.toISOString(),
      timeZone: previousPeriod.timeZone,
      partial: previousPeriod.partial,
    },
    orderCount: delta(current.orderCount, previous.orderCount),
  };
  if (role !== "OWNER") return base;
  return {
    ...base,
    revenueCents: delta(current.revenueCents, previous.revenueCents),
    averageTicketCents: delta(current.averageTicketCents, previous.averageTicketCents),
    discountCents: delta(current.discountCents, previous.discountCents),
  };
}
