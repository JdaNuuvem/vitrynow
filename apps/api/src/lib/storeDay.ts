// Dia civil no fuso da loja. O produto só atende no Brasil (America/Sao_Paulo, UTC-03:00 o ano todo desde 2019, sem horário de verão).
export const STORE_TIMEZONE = "America/Sao_Paulo";
const STORE_UTC_OFFSET = "-03:00";

export function storeToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: STORE_TIMEZONE });
}

// Fim do dia escolhido (23:59:59.999 no fuso da loja), inclusive. Nunca "meia-noite do começo": o cupom não pode morrer um dia antes.
export function endOfStoreDay(date: string): Date {
  return new Date(`${date}T23:59:59.999${STORE_UTC_OFFSET}`);
}

// Só dia ANTERIOR a hoje é passado; hoje ainda vale (até 23:59).
export function isBeforeToday(date: string, now: Date = new Date()): boolean {
  return date < storeToday(now);
}
