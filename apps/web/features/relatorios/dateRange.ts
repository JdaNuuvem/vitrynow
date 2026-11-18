import type { ReportRange } from "@/core/domain/reports";

// Período como os <input type="date"> o entregam ("AAAA-MM-DD").
export type DateRange = { from: string; to: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Período padrão: últimos 30 dias.
export function defaultRange(): DateRange {
  return { from: toDateInput(new Date(Date.now() - 30 * DAY_MS)), to: toDateInput(new Date()) };
}

// Campo vazio cai no mesmo padrão que a API usaria (30 dias atrás / agora).
export function toReportRange({ from, to }: DateRange): ReportRange {
  return {
    from: from ? new Date(from) : new Date(Date.now() - 30 * DAY_MS),
    to: to ? new Date(to) : new Date(),
  };
}
