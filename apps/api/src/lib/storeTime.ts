// Dia calendário no FUSO DA LOJA (`Store.timezone`): "hoje" do kanban (RN-KB-02) e períodos do histórico (RN-HP-02).
// Funções puras, com o relógio injetado. Usa só Intl (sem dependência) e acerta a virada de horário de verão.

type Local = { y: number; m: number; d: number; minutes: number; seconds: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Fuso inválido nunca derruba o painel: cai no padrão do produto. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  const candidate = timeZone || "America/Sao_Paulo";
  try {
    formatter(candidate);
    return candidate;
  } catch {
    return "America/Sao_Paulo";
  }
}

function localParts(instant: Date, timeZone: string): Local {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((part) => [part.type, Number(part.value)]));
  return { y: p.year, m: p.month, d: p.day, minutes: p.hour * 60 + p.minute, seconds: p.second };
}

function offsetMs(instant: Date, timeZone: string): number {
  const l = localParts(instant, timeZone);
  return Date.UTC(l.y, l.m - 1, l.d, 0, l.minutes, l.seconds) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante UTC de uma data local (ano, mês, dia) às 00:00 no fuso. */
export function localMidnightUtc(y: number, m: number, d: number, timeZone: string): Date {
  const naive = Date.UTC(y, m - 1, d, 0, 0);
  const first = naive - offsetMs(new Date(naive), timeZone);
  return new Date(naive - offsetMs(new Date(first), timeZone)); // 2ª passada acerta a virada de horário de verão
}

/** Início (00:00 local, em UTC) do dia da loja `offsetDays` dias a partir de `now` (0 = hoje, -1 = ontem, 1 = amanhã). */
export function startOfStoreDay(now: Date, timeZone: string, offsetDays = 0): Date {
  const tz = safeTimeZone(timeZone);
  const l = localParts(now, tz);
  const shifted = new Date(Date.UTC(l.y, l.m - 1, l.d + offsetDays));
  return localMidnightUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), tz);
}

/** "AAAA-MM-DD" → início do dia local em UTC; `null` se a data não existe (ex.: 2026-02-30). */
export function parseLocalDate(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return localMidnightUtc(y, m, d, safeTimeZone(timeZone));
}
