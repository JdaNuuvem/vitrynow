// "Há N min" do card e a cor de atraso (spec 02 §2, parecer R4 do Deming).
//
// A hora de referência é a do SERVIDOR: a API devolve `now`; a tela guarda
// `skewMs = nowServidor − nowNavegador` e a soma ao relógio local. Computador de restaurante com
// o relógio errado não gera alerta falso nem esconde atraso.

export type AgeLevel = "ok" | "warn" | "danger";

// Padrão da spec (RN B3.5); configurável depois.
export const WARN_AFTER_MIN = 5;
export const DANGER_AFTER_MIN = 10;

export function clockSkewMs(serverNowIso: string, browserNowMs: number): number {
  const server = Date.parse(serverNowIso);
  return Number.isNaN(server) ? 0 : server - browserNowMs;
}

export function minutesInState(statusChangedAtIso: string | undefined, browserNowMs: number, skewMs = 0): number | null {
  if (!statusChangedAtIso) return null;
  const changed = Date.parse(statusChangedAtIso);
  if (Number.isNaN(changed)) return null;
  const minutes = Math.floor((browserNowMs + skewMs - changed) / 60_000);
  return Math.max(0, minutes);
}

// O atraso só alerta em pedido NOVO (PENDENTE): parado em "pronto" não é o mesmo problema.
export function ageLevel(minutes: number | null, status: string): AgeLevel {
  if (minutes === null || status !== "PENDENTE") return "ok";
  if (minutes >= DANGER_AFTER_MIN) return "danger";
  if (minutes >= WARN_AFTER_MIN) return "warn";
  return "ok";
}

// O texto sempre diz o tempo; a cor só reforça (cor nunca sozinha).
export function ageText(minutes: number | null): string {
  if (minutes === null) return "";
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `há ${hours} h` : `há ${hours} h ${rest} min`;
}
