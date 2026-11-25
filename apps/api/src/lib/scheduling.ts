import { isOpenAt, type Schedule } from "../modules/storeHours/storeHours.domain";

// API-40 (PRO) — pedido agendado. Regras puras (relógio injetado), usadas pela rota do pedido e pelo job `schedule.release`.
// - O cliente escolhe um horário de 30 min a 7 dias à frente, dentro da grade de funcionamento da loja (mesmo com a loja fechada AGORA).
// - O pedido nasce RETIDO (fora do kanban e da impressão) e é solto `tempo de preparo` minutos antes do horário.
// - PIX é cobrado na criação (o prazo de 30 min do PIX continua valendo); só pedido pago é solto.

export const SCHEDULE_MIN_LEAD_MINUTES = 30;
export const SCHEDULE_MAX_DAYS = 7;
const MINUTE = 60_000;

export type ScheduleCheckInput = {
  scheduledFor: Date;
  now: Date;
  schedule: Schedule | null; // null = sem grade (sempre aberta, RN-B5-06)
  timeZone: string;
  closedUntil: Date | null; // "fechado até" manual do dono
};

export type ScheduleProblem = { code: "SCHEDULE_TOO_SOON" | "SCHEDULE_TOO_FAR" | "SCHEDULE_OUTSIDE_HOURS"; message: string };

export function checkScheduledFor(input: ScheduleCheckInput): ScheduleProblem | null {
  const { scheduledFor, now, schedule, timeZone, closedUntil } = input;
  const ahead = scheduledFor.getTime() - now.getTime();
  if (ahead < SCHEDULE_MIN_LEAD_MINUTES * MINUTE) {
    return { code: "SCHEDULE_TOO_SOON", message: `Agende com pelo menos ${SCHEDULE_MIN_LEAD_MINUTES} minutos de antecedência.` };
  }
  if (ahead > SCHEDULE_MAX_DAYS * 24 * 60 * MINUTE) {
    return { code: "SCHEDULE_TOO_FAR", message: `Agende para no máximo ${SCHEDULE_MAX_DAYS} dias à frente.` };
  }
  if ((closedUntil && closedUntil > scheduledFor) || (schedule && !isOpenAt(schedule, timeZone, scheduledFor))) {
    return { code: "SCHEDULE_OUTSIDE_HOURS", message: "A loja não atende nesse horário. Escolha outro." };
  }
  return null;
}

/** Minutos de preparo pelo tipo (os mesmos que a loja configura para a estimativa). */
export function prepMinutesFor(type: string, store: { prepMinutesDelivery: number | null; prepMinutesPickup: number | null }): number {
  return (type === "DELIVERY" ? store.prepMinutesDelivery : store.prepMinutesPickup) ?? 0;
}

/** Quando o pedido sai da retenção e vai para a cozinha. */
export function releaseAtFor(scheduledFor: Date, prepMinutes: number): Date {
  return new Date(scheduledFor.getTime() - Math.max(0, prepMinutes) * MINUTE);
}
