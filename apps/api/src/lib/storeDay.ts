// Dia civil no fuso da LOJA (`Store.timezone`; sem fuso válido, o padrão do produto). Funções puras, com o relógio e o fuso injetados.
import { DEFAULT_STORE_TIMEZONE, localMidnightUtc, safeTimeZone } from "./storeTime";

export function storeToday(now: Date = new Date(), timeZone: string = DEFAULT_STORE_TIMEZONE): string {
  return now.toLocaleDateString("en-CA", { timeZone: safeTimeZone(timeZone) });
}

// Fim do dia escolhido (23:59:59.999 no fuso da loja), inclusive. Nunca "meia-noite do começo": o cupom não pode morrer um dia antes.
export function endOfStoreDay(date: string, timeZone: string = DEFAULT_STORE_TIMEZONE): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(localMidnightUtc(y, m, d + 1, safeTimeZone(timeZone)).getTime() - 1);
}

// Só dia ANTERIOR a hoje é passado; hoje ainda vale (até 23:59).
export function isBeforeToday(date: string, now: Date = new Date(), timeZone: string = DEFAULT_STORE_TIMEZONE): boolean {
  return date < storeToday(now, timeZone);
}
