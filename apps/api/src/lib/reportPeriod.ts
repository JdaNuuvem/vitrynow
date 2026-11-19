// DADOS-1 / i2: a ÚNICA função de período da API (relatório, "hoje", caixa e histórico de pedidos). O fuso vem SEMPRE de `Store.timezone`
// (quem chama passa `storeTimeZone(storeId)`, do PR-04); aqui não existe literal de fuso. Dias são datas CIVIS da loja (`AAAA-MM-DD`, fim
// INCLUSIVO); a janela em UTC é [00:00 local do 1º dia, 00:00 local do dia seguinte ao último), calculada por `localMidnightUtc`, nunca
// "from + N × 24 h" (isso erra na virada de horário de verão).
import { localMidnightUtc, parseLocalDate, safeTimeZone } from "./storeTime";

export const MAX_REPORT_DAYS = 366;
export const DEFAULT_REPORT_DAYS = 30;
export const PERIOD_PRESETS = ["today", "yesterday", "7d", "30d", "thisMonth", "lastMonth"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export type RangeError = "INVALID_DATE" | "FROM_AFTER_TO" | "PERIOD_TOO_LONG";

export type ReportPeriod = {
  fromDate: string; // dia civil da loja, inclusivo
  toDate: string; // dia civil da loja, inclusivo
  fromUtc: Date;
  toExclusiveUtc: Date; // exclusivo
  timeZone: string;
  days: number;
  /** O período ainda não acabou (hoje em andamento): número parcial, avisa o dono (RN-DAD-04). */
  partial: boolean;
};

const DAY = 86_400_000;
const utcDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const shiftDate = (date: string, days: number) => new Date(utcDay(date) + days * DAY).toISOString().slice(0, 10); // aritmética de calendário (UTC puro, sem fuso)
export const dateOf = (instant: Date, timeZone: string) => instant.toLocaleDateString("en-CA", { timeZone: safeTimeZone(timeZone) });
const startOf = (date: string, timeZone: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return localMidnightUtc(y, m, d, timeZone);
};

// "AAAA-MM-DD" vale como está (dia da LOJA). Um instante ISO (formato antigo do painel) vira o dia da loja desse instante.
function toLocalDate(value: string, timeZone: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseLocalDate(value, timeZone) ? value : null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : dateOf(instant, timeZone);
}

function build(fromDate: string, toDate: string, timeZone: string, now: Date): ReportPeriod {
  const toExclusiveUtc = startOf(shiftDate(toDate, 1), timeZone);
  return {
    fromDate,
    toDate,
    fromUtc: startOf(fromDate, timeZone),
    toExclusiveUtc,
    timeZone,
    days: (utcDay(toDate) - utcDay(fromDate)) / DAY + 1,
    partial: toExclusiveUtc.getTime() > now.getTime(),
  };
}

export function resolveReportPeriod(
  input: { preset?: string; from?: string; to?: string },
  now: Date,
  rawTimeZone: string | null | undefined,
): ReportPeriod | { error: RangeError } {
  const timeZone = safeTimeZone(rawTimeZone);
  const today = dateOf(now, timeZone);
  if (input.preset) {
    const [y, m] = today.split("-").map(Number);
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    switch (input.preset as PeriodPreset) {
      case "today": return build(today, today, timeZone, now);
      case "yesterday": return build(shiftDate(today, -1), shiftDate(today, -1), timeZone, now);
      case "7d": return build(shiftDate(today, -6), today, timeZone, now);
      case "30d": return build(shiftDate(today, -29), today, timeZone, now);
      case "thisMonth": return build(monthStart, today, timeZone, now);
      case "lastMonth": return build(shiftDate(monthStart, -1).slice(0, 8) + "01", shiftDate(monthStart, -1), timeZone, now);
      default: return { error: "INVALID_DATE" };
    }
  }
  const toDate = input.to ? toLocalDate(input.to, timeZone) : today;
  if (!toDate) return { error: "INVALID_DATE" };
  const fromDate = input.from ? toLocalDate(input.from, timeZone) : shiftDate(toDate, -(DEFAULT_REPORT_DAYS - 1));
  if (!fromDate) return { error: "INVALID_DATE" };
  if (fromDate > toDate) return { error: "FROM_AFTER_TO" };
  if ((utcDay(toDate) - utcDay(fromDate)) / DAY + 1 > MAX_REPORT_DAYS) return { error: "PERIOD_TOO_LONG" };
  return build(fromDate, toDate, timeZone, now);
}

/**
 * Período anterior (M13): MESMO número de dias imediatamente antes. Exceção do "hoje" (um dia ainda em andamento): o MESMO dia da semana
 * anterior, só até a mesma hora (hoje até 14:30 × quarta passada até 14:30), para não comparar meio dia com dia inteiro.
 */
export function previousPeriod(period: ReportPeriod, now: Date): ReportPeriod {
  const tz = period.timeZone;
  if (period.days === 1 && period.partial) {
    const day = shiftDate(period.fromDate, -7);
    const prev = build(day, day, tz, now);
    const elapsed = now.getTime() - period.fromUtc.getTime();
    return { ...prev, toExclusiveUtc: new Date(Math.min(prev.fromUtc.getTime() + elapsed, prev.toExclusiveUtc.getTime())), partial: false };
  }
  return build(shiftDate(period.fromDate, -period.days), shiftDate(period.fromDate, -1), tz, now);
}
