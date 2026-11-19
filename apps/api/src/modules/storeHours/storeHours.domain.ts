// Horário de funcionamento (B5, RN-B5-*): núcleo PURO — sem banco, sem relógio próprio (recebe `now`).
// Tudo é calculado no servidor, no fuso da loja (RN-B5-02): `Store.timezone`.

export type Interval = { start: string; end: string }; // "HH:MM"; end pode ser "24:00"
export type ScheduleException = { date: string; closed: boolean; intervals?: Interval[] }; // date = AAAA-MM-DD (local)
export type Schedule = {
  /** Índice 0 = domingo. Dia sem intervalo = fechado. */
  week: Interval[][];
  exceptions: ScheduleException[];
  /** Para de aceitar pedido novo X min antes de fechar (padrão 0). */
  cutoffMinutes: number;
};

export type StoreState = "ABERTO" | "FECHADO" | "PAUSADO";
export type ClosedReason = "SWITCHED_OFF" | "PAUSED" | "CLOSED_TODAY" | "OUTSIDE_HOURS";

export type StoreStatus = {
  status: StoreState;
  reason: ClosedReason | null;
  /** Próxima abertura (ISO) quando se sabe; `null` se desligada ou sem abertura nos próximos dias. */
  nextOpenAt: string | null;
  /** Quando deixa de aceitar pedido (ISO), só quando ABERTO e há grade. */
  closesAt: string | null;
  /** Texto pronto em português (RN-B5-04). */
  message: string;
};

export type StatusInput = {
  schedule: Schedule | null;
  timezone: string;
  now: Date;
  acceptingOrders: boolean;
  pausedUntil: Date | null;
  closedUntil: Date | null;
};

const MIN_MS = 60_000;
const DAY_MIN = 1440;
const LOOKAHEAD_DAYS = 8;
const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// ───────────── fuso horário ─────────────

type Local = { y: number; m: number; d: number; minutes: number; weekday: number; seconds: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Data/hora local no fuso (ano, mês, dia, minutos desde 00:00, dia da semana). */
export function localParts(instant: Date, timeZone: string): Local {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((p) => [p.type, Number(p.value)]));
  const y = parts.year;
  const m = parts.month;
  const d = parts.day;
  return {
    y,
    m,
    d,
    minutes: parts.hour * 60 + parts.minute,
    seconds: parts.second,
    weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const l = localParts(instant, timeZone);
  const asUtc = Date.UTC(l.y, l.m - 1, l.d, 0, l.minutes, l.seconds);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante UTC de uma data local + minutos desde 00:00 (aceita >= 1440: dia seguinte). */
export function localToUtc(y: number, m: number, d: number, minutes: number, timeZone: string): Date {
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone); // 2ª passada acerta a virada de horário de verão
  return new Date(guess);
}

function addDays(y: number, m: number, d: number, days: number) {
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), weekday: date.getUTCDay() };
}

const isoDate = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// ───────────── validação (RN-B5-10) ─────────────

/** Mensagens de erro em português; lista vazia = válida. */
export function validateSchedule(schedule: Schedule): string[] {
  const errors: string[] = [];
  const dayNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

  const checkIntervals = (label: string, intervals: Interval[]) => {
    const spans: Array<{ s: number; e: number; text: string }> = [];
    for (const interval of intervals) {
      const s = toMinutes(interval.start);
      const e = toMinutes(interval.end);
      if (s === e) {
        errors.push(`${label}: o início ${interval.start} não pode ser igual ao fim.`);
        continue;
      }
      // fim antes do início = passa da meia-noite (termina no dia seguinte)
      spans.push({ s, e: e > s ? e : e + DAY_MIN, text: `${interval.start}-${interval.end}` });
    }
    spans.sort((a, b) => a.s - b.s);
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].s < spans[i - 1].e) errors.push(`${label}: os horários ${spans[i - 1].text} e ${spans[i].text} se sobrepõem.`);
    }
    return spans;
  };

  const overnightEnd: Array<{ label: string; endMinutes: number; nextDayIndex: number }> = [];
  schedule.week.forEach((intervals, index) => {
    const spans = checkIntervals(dayNames[index], intervals);
    for (const span of spans) if (span.e > DAY_MIN) overnightEnd.push({ label: dayNames[index], endMinutes: span.e - DAY_MIN, nextDayIndex: (index + 1) % 7 });
  });
  // um horário que passa da meia-noite não pode invadir o primeiro intervalo do dia seguinte
  for (const o of overnightEnd) {
    const next = schedule.week[o.nextDayIndex].map((i) => toMinutes(i.start)).sort((a, b) => a - b)[0];
    if (next !== undefined && next < o.endMinutes) {
      errors.push(`${o.label}: o horário que vai até ${hhmm(o.endMinutes)} do dia seguinte se sobrepõe ao de ${dayNames[o.nextDayIndex]}.`);
    }
  }

  const seen = new Set<string>();
  for (const exception of schedule.exceptions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.date) || Number.isNaN(Date.parse(`${exception.date}T00:00:00Z`)) || new Date(`${exception.date}T00:00:00Z`).toISOString().slice(0, 10) !== exception.date) {
      errors.push(`Exceção ${exception.date}: data inválida.`);
      continue;
    }
    if (seen.has(exception.date)) errors.push(`Exceção ${exception.date}: data repetida.`);
    seen.add(exception.date);
    if (exception.closed) continue;
    if (!exception.intervals || exception.intervals.length === 0) errors.push(`Exceção ${exception.date}: informe os horários especiais ou marque "fechado o dia todo".`);
    else checkIntervals(`Exceção ${exception.date}`, exception.intervals);
  }
  return errors;
}

/** Descarta exceções de datas já passadas (RN: arquivadas, sem efeito). */
export function pruneExceptions(schedule: Schedule, now: Date, timeZone: string): Schedule {
  const l = localParts(now, timeZone);
  const today = isoDate(l.y, l.m, l.d);
  return { ...schedule, exceptions: schedule.exceptions.filter((e) => e.date >= today) };
}

// ───────────── janelas de funcionamento ─────────────

type Window = { start: Date; end: Date };

/** Janelas abertas (início/fim reais da loja, já unidas quando encostam) de ontem a +LOOKAHEAD dias. */
function rawWindows(schedule: Schedule, timeZone: string, now: Date): Window[] {
  const today = localParts(now, timeZone);
  const exceptions = new Map(schedule.exceptions.map((e) => [e.date, e]));
  const windows: Window[] = [];
  for (let offset = -1; offset <= LOOKAHEAD_DAYS; offset++) {
    const day = addDays(today.y, today.m, today.d, offset);
    const exception = exceptions.get(isoDate(day.y, day.m, day.d));
    const intervals = exception ? (exception.closed ? [] : (exception.intervals ?? [])) : (schedule.week[day.weekday] ?? []);
    for (const interval of intervals) {
      const s = toMinutes(interval.start);
      let e = toMinutes(interval.end);
      if (e <= s) e += DAY_MIN;
      windows.push({ start: localToUtc(day.y, day.m, day.d, s, timeZone), end: localToUtc(day.y, day.m, day.d, e, timeZone) });
    }
  }
  windows.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Window[] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start.getTime() <= last.end.getTime()) {
      if (w.end > last.end) last.end = w.end;
    } else merged.push({ ...w });
  }
  return merged;
}

/** Janelas em que se ACEITA pedido: fim real menos o corte de antecedência. */
export function acceptingWindows(schedule: Schedule, timeZone: string, now: Date): Window[] {
  const cut = schedule.cutoffMinutes * MIN_MS;
  return rawWindows(schedule, timeZone, now)
    .map((w) => ({ start: w.start, end: new Date(w.end.getTime() - cut) }))
    .filter((w) => w.end > w.start);
}

/** Aberto AGORA = há uma janela de ACEITAR pedido que contém `now` (o MESMO cálculo de `computeStoreStatus`; pausa e interruptor ficam fora daqui). */
export function isOpenAt(schedule: Schedule, timeZone: string, now: Date): boolean {
  return acceptingWindows(schedule, timeZone, now).some((w) => w.start <= now && now < w.end);
}

const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0]; // segunda a domingo (o índice 0 da grade é domingo)
const DAY_TITLES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Texto de horário GERADO da grade (fonte única, SSOT D2): "Seg a sáb 09:00–17:00" ou "Seg a sex 09:00–17:00; Sáb 09:00–13:00". Dias com o mesmo horário e
 * seguidos viram faixa ("Seg a qua"; 2 dias = "Seg e ter"). Sem nenhum dia aberto: "Fechado". Não usa exceções (feriado muda o dia, não a grade semanal).
 */
export function hoursText(schedule: Schedule): string {
  const label = (intervals: Interval[]) => intervals.map((i) => `${i.start}–${i.end}`).join(", ");
  const groups: Array<{ days: number[]; text: string }> = [];
  for (const day of DISPLAY_DAYS) {
    const intervals = [...(schedule.week[day] ?? [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    if (intervals.length === 0) continue;
    const text = label(intervals);
    const last = groups[groups.length - 1];
    const previous = last ? DISPLAY_DAYS.indexOf(last.days[last.days.length - 1]) : -2;
    if (last && last.text === text && previous === DISPLAY_DAYS.indexOf(day) - 1) last.days.push(day);
    else groups.push({ days: [day], text });
  }
  if (groups.length === 0) return "Fechado";
  const name = (d: number, first: boolean) => (first ? DAY_TITLES[d] : DAY_TITLES[d].toLowerCase());
  return groups
    .map(({ days, text }) => {
      const range = days.length === 1 ? name(days[0], true) : days.length === 2 ? `${name(days[0], true)} e ${name(days[1], false)}` : `${name(days[0], true)} a ${name(days[days.length - 1], false)}`;
      return `${range} ${text}`;
    })
    .join("; ");
}

/** Próxima abertura estritamente depois de `after`. */
export function nextOpening(schedule: Schedule, timeZone: string, after: Date): Date | null {
  return acceptingWindows(schedule, timeZone, after).find((w) => w.start > after)?.start ?? null;
}

// ───────────── mensagens e status ─────────────

function dayLabel(target: Date, now: Date, timeZone: string): string {
  const t = localParts(target, timeZone);
  const n = localParts(now, timeZone);
  const diff = Math.round((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(n.y, n.m - 1, n.d)) / (DAY_MIN * MIN_MS));
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return WEEKDAYS_SHORT[t.weekday];
}

const timeLabel = (instant: Date, timeZone: string) => hhmm(localParts(instant, timeZone).minutes);

function opensMessage(next: Date, now: Date, timeZone: string): string {
  return `Abrimos ${dayLabel(next, now, timeZone)} às ${timeLabel(next, timeZone)}`;
}

/** Estado da loja agora (RN-B5-01: a assinatura é decidida ANTES, pelo portão da assinatura). */
export function computeStoreStatus(input: StatusInput): StoreStatus {
  const { schedule, timezone, now, acceptingOrders, pausedUntil, closedUntil } = input;

  if (!acceptingOrders) {
    return { status: "FECHADO", reason: "SWITCHED_OFF", nextOpenAt: null, closesAt: null, message: "A loja não está recebendo pedidos agora." };
  }
  if (pausedUntil && pausedUntil > now) {
    const minutes = Math.max(1, Math.ceil((pausedUntil.getTime() - now.getTime()) / MIN_MS));
    return { status: "PAUSADO", reason: "PAUSED", nextOpenAt: pausedUntil.toISOString(), closesAt: null, message: `Voltamos em ${minutes} min` };
  }
  if (closedUntil && closedUntil > now) {
    return {
      status: "FECHADO",
      reason: "CLOSED_TODAY",
      nextOpenAt: closedUntil.toISOString(),
      closesAt: null,
      message: `Fechado hoje. ${opensMessage(closedUntil, now, timezone)}`,
    };
  }
  if (!schedule) return { status: "ABERTO", reason: null, nextOpenAt: null, closesAt: null, message: "Aberto" }; // RN-B5-06

  const windows = acceptingWindows(schedule, timezone, now);
  const current = windows.find((w) => w.start <= now && now < w.end);
  if (current) {
    // Grade contínua (ex.: 24 h todos os dias): o fim da janela é só o horizonte do cálculo, não um fechamento.
    if (current.end.getTime() - now.getTime() > (LOOKAHEAD_DAYS - 1) * DAY_MIN * MIN_MS) {
      return { status: "ABERTO", reason: null, nextOpenAt: null, closesAt: null, message: "Aberto" };
    }
    return { status: "ABERTO", reason: null, nextOpenAt: null, closesAt: current.end.toISOString(), message: `Aberto até ${timeLabel(current.end, timezone)}` };
  }
  const next = windows.find((w) => w.start > now);
  if (!next) return { status: "FECHADO", reason: "OUTSIDE_HOURS", nextOpenAt: null, closesAt: null, message: "Fechado" };
  return { status: "FECHADO", reason: "OUTSIDE_HOURS", nextOpenAt: next.start.toISOString(), closesAt: null, message: opensMessage(next.start, now, timezone) };
}

/** "Fechar por hoje": até a próxima abertura da grade; sem grade, até a meia-noite local. */
export function closeTodayUntil(schedule: Schedule | null, timeZone: string, now: Date): Date {
  if (schedule) {
    const next = nextOpening(schedule, timeZone, now);
    if (next) return next;
  }
  const l = localParts(now, timeZone);
  const tomorrow = addDays(l.y, l.m, l.d, 1);
  return localToUtc(tomorrow.y, tomorrow.m, tomorrow.d, 0, timeZone);
}

/** Lê o JSON gravado em `Store.schedule`; formato inesperado vira "sem grade" (nunca derruba a loja). */
export function parseStoredSchedule(raw: unknown): Schedule | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Schedule>;
  if (!Array.isArray(value.week) || value.week.length !== 7) return null;
  return {
    week: value.week.map((day) => (Array.isArray(day) ? day : [])),
    exceptions: Array.isArray(value.exceptions) ? value.exceptions : [],
    cutoffMinutes: typeof value.cutoffMinutes === "number" && value.cutoffMinutes >= 0 ? value.cutoffMinutes : 0,
  };
}
