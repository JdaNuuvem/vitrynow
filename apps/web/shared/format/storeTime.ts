// SSOT D1 — FUSO DA LOJA. Toda data e hora que o painel ou a vitrine mostram (ou transformam em período) usa o fuso
// da LOJA (`Store.timezone`, vindo da API), nunca o do aparelho de quem olha. Este é o ÚNICO arquivo do web com o
// literal do fuso padrão (teste-guarda: storeTime.guard.test.ts).

export const DEFAULT_STORE_TIMEZONE = "America/Sao_Paulo";

const valid = new Map<string, boolean>();
/** Fuso IANA válido, ou o padrão (fuso vazio, ausente ou desconhecido nunca quebra a tela). */
export function safeTimeZone(timeZone?: string | null): string {
  const tz = timeZone?.trim();
  if (!tz) return DEFAULT_STORE_TIMEZONE;
  if (!valid.has(tz)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      valid.set(tz, true);
    } catch {
      valid.set(tz, false);
    }
  }
  return valid.get(tz) ? tz : DEFAULT_STORE_TIMEZONE;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function cached(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

/** Formata no fuso da loja (pt-BR). `options` são as do Intl, SEM `timeZone` (o fuso vem do 2º argumento). */
export function formatInStoreTimezone(date: Date | string | number, timeZone: string | null | undefined, options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = { dateStyle: "short", timeStyle: "short" }): string {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return "";
  return cached("pt-BR", { ...options, timeZone: safeTimeZone(timeZone) }).format(value);
}

/** "AAAA-MM-DD" do calendário da loja (o formato do <input type="date"> e dos períodos da API). */
export function storeDateInput(date: Date, timeZone?: string | null): string {
  return cached("sv-SE", { timeZone: safeTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Relógio de parede da loja no instante dado (weekday 0 = domingo). */
export function localParts(instant: Date, timeZone?: string | null): LocalParts {
  const f = cached("en-US", { timeZone: safeTimeZone(timeZone), hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const map = Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
  return { year: +map.year, month: +map.month, day: +map.day, hour: +map.hour % 24, minute: +map.minute, weekday: WEEKDAYS.indexOf(map.weekday) };
}

const MINUTE = 60_000;
function offsetMs(instant: number, timeZone: string): number {
  const p = localParts(new Date(instant), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(instant / MINUTE) * MINUTE;
}

/** Hora local da loja -> instante UTC (corrige uma vez para atravessar mudança de horário de verão). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone?: string | null): Date {
  const tz = safeTimeZone(timeZone);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall - offsetMs(wall, tz);
  instant = wall - offsetMs(instant, tz);
  return new Date(instant);
}

/** 00:00 da loja no dia "AAAA-MM-DD" (início de período). Data inválida -> Date inválida. */
export function storeMidnight(dateInput: string, timeZone?: string | null): Date {
  const [y, m, d] = dateInput.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return zonedToUtc(y, m, d, 0, 0, timeZone);
}

// Fuso da loja ATIVA (painel: StoreProvider ao carregar as configurações; cardápio: a página da loja ao carregar o menu).
// Serve aos formatadores que vivem fora de componente (onde não há hook). Sem loja carregada ainda, o padrão.
let activeTimeZone: string = DEFAULT_STORE_TIMEZONE;
export function setActiveStoreTimezone(timeZone?: string | null): void {
  activeTimeZone = safeTimeZone(timeZone);
}
export function activeStoreTimezone(): string {
  return activeTimeZone;
}
