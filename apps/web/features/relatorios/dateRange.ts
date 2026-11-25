import type { ReportRange } from "@/core/domain/reports";
import { storeDateInput, storeMidnight } from "@/shared/format/storeTime";

// Período como os <input type="date"> o entregam ("AAAA-MM-DD"), sempre no calendário da LOJA (SSOT D1).
export type DateRange = { from: string; to: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDateInput(date: Date, timeZone?: string | null): string {
  return storeDateInput(date, timeZone);
}

// Período padrão: últimos 30 dias.
export function defaultRange(now = new Date(), timeZone?: string | null): DateRange {
  return { from: toDateInput(new Date(now.getTime() - 29 * DAY_MS), timeZone), to: toDateInput(now, timeZone) };
}

// A API soma 24 horas ao instante "to". As duas pontas começam à meia-noite DA LOJA (antes: -03:00 fixo, errado fora de SP).
export function toReportRange({ from, to }: DateRange, timeZone?: string | null): ReportRange {
  const fallback = !from || !to ? defaultRange(new Date(), timeZone) : undefined;
  return {
    from: storeMidnight(from || fallback!.from, timeZone),
    to: storeMidnight(to || fallback!.to, timeZone),
  };
}
