// API-17 (B11): "Esgotado hoje". Regra única de quando um produto conta como esgotado.
// RN-B11-02: "até o fim de hoje" volta às 04:00 do fuso da loja (America/Sao_Paulo, UTC-03:00 o ano todo);
// a volta na próxima abertura da grade de horários (B5) entra junto com a API-11.
const RESET_HOUR_UTC = 7; // 04:00 em UTC-03:00

export type SoldOutState = { soldOut: boolean; soldOutUntil: Date | null };

// Próximo 04:00 do fuso da loja ESTRITAMENTE depois de `now`.
export function nextSoldOutReset(now: Date = new Date()): Date {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RESET_HOUR_UTC));
  if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

// Esgotado agora? `soldOutUntil` nulo com soldOut = true é "até eu reativar".
export function isSoldOutNow(product: SoldOutState, now: Date = new Date()): boolean {
  if (!product.soldOut) return false;
  return product.soldOutUntil === null || product.soldOutUntil.getTime() > now.getTime();
}
