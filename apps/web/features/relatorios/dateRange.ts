import type { ReportRange } from "@/core/domain/reports";

// Período como os <input type="date"> o entregam ("AAAA-MM-DD").
export type DateRange = { from: string; to: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDateInput(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(date);
}

// Período padrão: últimos 30 dias.
export function defaultRange(now = new Date()): DateRange {
  return { from: toDateInput(new Date(now.getTime() - 29 * DAY_MS)), to: toDateInput(now) };
}

// A API soma 24 horas ao instante “to”. As duas pontas devem começar à meia-noite da loja.
export function toReportRange({ from, to }: DateRange): ReportRange {
  const fallback = !from || !to ? defaultRange() : undefined;
  return {
    from: new Date(`${from || fallback?.from}T00:00:00-03:00`),
    to: new Date(`${to || fallback?.to}T00:00:00-03:00`),
  };
}
