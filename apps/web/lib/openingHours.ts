// Interpretação best-effort de um texto livre de horário de funcionamento
// (ex. "Seg a sáb, 09:00 às 18:00") pra decidir se a loja está aberta agora.
// Cobre o padrão mais comum (intervalo de dias + intervalo de horário); formatos que
// fogem disso retornam null e a UI só mostra o texto, sem badge de aberto/fechado.
const DAY_NAMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

function stripAccents(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function isStoreOpenNow(openingHours: string | null | undefined, now: Date = new Date()): boolean | null {
  if (!openingHours) return null;
  const normalized = stripAccents(openingHours);

  const timeMatch = normalized.match(/(\d{1,2})[h:](\d{2})?\s*(?:as|a|-|ate)\s*(\d{1,2})[h:](\d{2})?/);
  if (!timeMatch) return null;
  const [, h1, m1, h2, m2] = timeMatch;
  const startMinutes = parseInt(h1, 10) * 60 + parseInt(m1 || "0", 10);
  const endMinutes = parseInt(h2, 10) * 60 + parseInt(m2 || "0", 10);

  let allowedDays: number[] | null = null;
  const dayRangeMatch = normalized.match(/(dom|seg|ter|qua|qui|sex|sab)[a-z]*\s*a\s*(dom|seg|ter|qua|qui|sex|sab)[a-z]*/);
  if (dayRangeMatch) {
    const start = DAY_NAMES.indexOf(dayRangeMatch[1]);
    const end = DAY_NAMES.indexOf(dayRangeMatch[2]);
    if (start !== -1 && end !== -1) {
      allowedDays = [];
      let d = start;
      for (let i = 0; i < 7; i++) {
        allowedDays.push(d);
        if (d === end) break;
        d = (d + 1) % 7;
      }
    }
  }

  if (allowedDays && !allowedDays.includes(now.getDay())) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}
