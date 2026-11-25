// PR-03 / a2: SUGERE uma grade semanal a partir do texto livre antigo (`Store.openingHours`). PURO (sem banco, sem relógio) e CONSERVADOR: o que não entende vira
// DÚVIDA, nunca um palpite; o resultado NUNCA é gravado aqui (quem grava é o `POST /api/store/hours` existente, depois que o dono confere).
// Entende, por trecho separado por ";" "|" "/" ou quebra de linha: dias ("seg a sáb", "seg, qua e sex", "todos os dias", "fim de semana", "dias úteis", "dom"),
// faixas ("09:00–17:00", "9h às 17h30", "11h às 15h e 18h às 23h", "22h às 02h" = vira a meia-noite) e "fechado".
import { validateSchedule, type Interval, type Schedule } from "./storeHours.domain";

export type HoursDoubt = { text: string; reason: string };
export type HoursSuggestion = { schedule: Schedule | null; complete: boolean; doubts: HoursDoubt[] };

const DAY_WORDS: Array<[RegExp, number]> = [
  [/^dom(ingo)?$/, 0],
  [/^seg(unda)?$/, 1],
  [/^ter(ca)?$/, 2],
  [/^qua(rta)?$/, 3],
  [/^qui(nta)?$/, 4],
  [/^sex(ta)?$/, 5],
  [/^sab(ado)?$/, 6],
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/-feira/g, "").replace(/\s+/g, " ").trim();
const dayOf = (word: string) => DAY_WORDS.find(([re]) => re.test(word))?.[1];
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** "seg a sex" percorre a semana em ordem (com volta: "sex a dom" = sex, sáb, dom). Domingo é 0, mas na fala vem por último. */
function dayRange(from: number, to: number): number[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  const days: number[] = [];
  for (let i = a; ; i = (i + 1) % 7) {
    days.push(order[i]);
    if (i === b) break;
    if (days.length > 7) break;
  }
  return days;
}

/** Dias de um trecho como "seg a sáb", "seg, qua e sex", "todos os dias". `null` = não entendi. */
function parseDays(raw: string): number[] | null {
  let text = normalize(raw).replace(/^(de|das|dos|a partir de)\s+/, "").replace(/[:,\s]+$/, "");
  text = text.replace(/\s+(das|de|do|dos|a|as|ao)$/, "").replace(/[:,\s]+$/, ""); // conectivo que sobra antes da hora ("segunda a sábado das 9h")
  if (!text) return null;
  if (/^(todos os dias|todo dia|diariamente|todos dia|seg a dom|segunda a domingo)$/.test(text)) return ALL_DAYS;
  if (/^dias uteis$/.test(text)) return [1, 2, 3, 4, 5];
  if (/^(fim|fins|final|finais) de semana$/.test(text)) return [6, 0];
  text = text.replace(/\s+e\s+/g, ",");
  const days = new Set<number>();
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const range = /^(\w+) (?:a|ate|as) (\w+)$/.exec(part);
    if (range) {
      const from = dayOf(range[1]);
      const to = dayOf(range[2]);
      if (from === undefined || to === undefined) return null;
      for (const d of dayRange(from, to)) days.add(d);
      continue;
    }
    const single = dayOf(part);
    if (single === undefined) return null;
    days.add(single);
  }
  return days.size > 0 ? [...days] : null;
}

const TIME = String.raw`(\d{1,2})(?:(?::|h)(\d{2})?)?\s*h?`;
const INTERVAL = new RegExp(`${TIME}\\s*(?:as|a|-|–|—|ate)\\s*${TIME}`, "g");

/** Faixas de um trecho; devolve também o que SOBROU do texto (se sobrou algo além de conectivos, é dúvida). */
function parseIntervals(raw: string): { intervals: Interval[]; leftover: string; error?: string } {
  const text = normalize(raw).replace(/^(das|de|do|ao|as)\s+/, "");
  const intervals: Interval[] = [];
  let error: string | undefined;
  const rest = text.replace(INTERVAL, (_all, h1, m1, h2, m2) => {
    const start = [Number(h1), m1 === undefined ? 0 : Number(m1)];
    const end = [Number(h2), m2 === undefined ? 0 : Number(m2)];
    const validStart = start[0] >= 0 && start[0] <= 23 && start[1] >= 0 && start[1] <= 59;
    const validEnd = (end[0] >= 0 && end[0] <= 23 && end[1] >= 0 && end[1] <= 59) || (end[0] === 24 && end[1] === 0);
    if (!validStart || !validEnd) {
      error = `horário inválido (${_all.trim()})`;
      return " ";
    }
    const interval = { start: hhmm(start[0], start[1]), end: hhmm(end[0], end[1]) };
    if (interval.start === interval.end) {
      error = `abre e fecha no mesmo horário (${_all.trim()})`;
      return " ";
    }
    intervals.push(interval);
    return " ";
  });
  const leftover = rest.replace(/\b(e|ou|das|de|as|a|h)\b|[,.\s]/g, " ").replace(/\s+/g, " ").trim();
  return { intervals, leftover, ...(error ? { error } : {}) };
}

export function suggestSchedule(text: string): HoursSuggestion {
  const doubts: HoursDoubt[] = [];
  const week: Interval[][] = Array.from({ length: 7 }, () => []);
  const closed = new Set<number>();
  const segments = text.split(/[;|\n/]+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return { schedule: null, complete: false, doubts: [{ text: "", reason: "Não há texto de horário para interpretar." }] };

  let understood = 0;
  for (const segment of segments) {
    const firstDigit = segment.search(/\d/);
    const hasClosedWord = /fechad[oa]/i.test(segment);
    const dayText = firstDigit === -1 ? segment.replace(/fechad[oa]/gi, "") : segment.slice(0, firstDigit);
    const timeText = firstDigit === -1 ? "" : segment.slice(firstDigit);
    const days = parseDays(dayText);
    if (!days) {
      doubts.push({ text: segment, reason: "Não entendi quais são os dias." });
      continue;
    }
    if (hasClosedWord && firstDigit === -1) {
      for (const d of days) closed.add(d);
      understood += 1;
      continue;
    }
    if (firstDigit === -1) {
      doubts.push({ text: segment, reason: "Faltou o horário (ex.: 09:00 às 17:00)." });
      continue;
    }
    const { intervals, leftover, error } = parseIntervals(timeText);
    if (error || intervals.length === 0 || leftover) {
      doubts.push({ text: segment, reason: error ?? (leftover ? `Não entendi "${leftover}".` : "Não entendi o horário.") });
      continue;
    }
    for (const d of days) {
      if (closed.has(d) || week[d].length > 0) {
        doubts.push({ text: segment, reason: "Este dia aparece mais de uma vez no texto." });
        break;
      }
    }
    if (doubts.some((x) => x.text === segment)) continue;
    for (const d of days) week[d].push(...intervals);
    understood += 1;
  }

  if (understood === 0) return { schedule: null, complete: false, doubts };
  const schedule: Schedule = { week, exceptions: [], cutoffMinutes: 0 };
  const problems = validateSchedule(schedule);
  if (problems.length > 0) {
    // A grade montada não passa na validação do servidor: nunca sugerimos uma grade que o dono não conseguiria salvar.
    return { schedule: null, complete: false, doubts: [...doubts, ...problems.map((reason) => ({ text: "", reason }))] };
  }
  return { schedule, complete: doubts.length === 0, doubts };
}
