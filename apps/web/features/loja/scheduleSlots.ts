// Pedido agendado (API-40): dias e horários que o cliente pode escolher, SEMPRE no fuso da LOJA (não do aparelho).
// Mesmas regras do servidor: de 30 min a 7 dias à frente. A grade de funcionamento quem confere é o servidor
// (responde SCHEDULE_OUTSIDE_HOURS com a frase pronta); aqui só não oferecemos o impossível.

export const SCHEDULE_MIN_LEAD_MINUTES = 30;
export const SCHEDULE_MAX_DAYS = 7;
export const SCHEDULE_STEP_MINUTES = 15;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Conversões de fuso: uma só implementação, em shared/format/storeTime (SSOT D1).
export { localParts, zonedToUtc } from "@/shared/format/storeTime";
import { localParts, zonedToUtc } from "@/shared/format/storeTime";

const pad = (n: number) => String(n).padStart(2, "0");
const DAY_NAMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export type DayOption = { value: string; label: string };
export type TimeOption = { value: string; label: string };

/** Hoje + os próximos 7 dias, no calendário da loja. */
export function scheduleDays(now: Date, timeZone: string): DayOption[] {
  const days: DayOption[] = [];
  for (let i = 0; i <= SCHEDULE_MAX_DAYS; i += 1) {
    const p = localParts(new Date(now.getTime() + i * DAY), timeZone);
    const value = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    if (days.some((d) => d.value === value)) continue; // dia com mudança de horário de verão
    const label = i === 0 ? "Hoje" : i === 1 ? "Amanhã" : `${DAY_NAMES[p.weekday]}, ${pad(p.day)}/${pad(p.month)}`;
    days.push({ value, label });
  }
  return days;
}

/** Horários de 15 em 15 min no dia escolhido (AAAA-MM-DD da loja), entre agora + 30 min e agora + 7 dias. */
export function scheduleTimes(day: string, now: Date, timeZone: string): TimeOption[] {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return [];
  const earliest = now.getTime() + SCHEDULE_MIN_LEAD_MINUTES * MINUTE;
  const latest = now.getTime() + SCHEDULE_MAX_DAYS * DAY;
  const times: TimeOption[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += SCHEDULE_STEP_MINUTES) {
    const instant = zonedToUtc(year, month, date, Math.floor(minutes / 60), minutes % 60, timeZone);
    const back = localParts(instant, timeZone);
    if (back.day !== date || back.hour * 60 + back.minute !== minutes) continue; // horário que não existe (salto do horário de verão)
    if (instant.getTime() < earliest || instant.getTime() > latest) continue;
    times.push({ value: instant.toISOString(), label: `${pad(back.hour)}:${pad(back.minute)}` });
  }
  return times;
}

/** "qua, 26/11 às 19:30" no fuso da loja, para o resumo e a confirmação. */
export function scheduleLabel(iso: string, timeZone: string): string {
  const p = localParts(new Date(iso), timeZone);
  return `${DAY_NAMES[p.weekday]}, ${pad(p.day)}/${pad(p.month)} às ${pad(p.hour)}:${pad(p.minute)}`;
}
