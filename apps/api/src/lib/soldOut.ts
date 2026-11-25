// API-17 (B11): "Esgotado hoje". Regra única de quando um produto conta como esgotado.
// RN-B11-02: "até o fim de hoje" volta às 04:00 do fuso da LOJA (`Store.timezone`);
// a volta na próxima abertura da grade de horários (B5) entra junto com a API-11.
import { DEFAULT_STORE_TIMEZONE, startOfStoreDay } from "./storeTime";

const RESET_HOUR = 4;

export type SoldOutState = { soldOut: boolean; soldOutUntil: Date | null };

// Próximo 04:00 do fuso da loja ESTRITAMENTE depois de `now`.
export function nextSoldOutReset(now: Date = new Date(), timeZone: string = DEFAULT_STORE_TIMEZONE): Date {
  const today = new Date(startOfStoreDay(now, timeZone, 0).getTime() + RESET_HOUR * 3_600_000);
  return today.getTime() > now.getTime() ? today : new Date(startOfStoreDay(now, timeZone, 1).getTime() + RESET_HOUR * 3_600_000);
}

// Esgotado agora? `soldOutUntil` nulo com soldOut = true é "até eu reativar".
export function isSoldOutNow(product: SoldOutState, now: Date = new Date()): boolean {
  if (!product.soldOut) return false;
  return product.soldOutUntil === null || product.soldOutUntil.getTime() > now.getTime();
}
