import { errorMessages } from "@meucardapio/shared-types/errors";

// SSOT D6: texto de erro APROVADO no catálogo único (packages/shared-types/src/errorMessages.ts) tem prioridade sobre o texto da API.
// Rascunho/`api(...)` (reviewed: false) e código desconhecido devolvem undefined: vale o texto que a API mandou.
const catalog: Record<string, { message: string; reviewed: boolean } | undefined> = errorMessages;

export function catalogMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const entry = Object.prototype.hasOwnProperty.call(catalog, code) ? catalog[code] : undefined;
  return entry?.reviewed ? entry.message : undefined;
}
