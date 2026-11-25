"use client";

import { safeTimeZone } from "@/shared/format/storeTime";
import { useStore } from "./StoreProvider";

/** SSOT D1: fuso da loja aberta no painel (vem de GET /api/store/settings). Enquanto carrega, o padrão. */
export function useStoreTimezone(): string {
  return safeTimeZone(useStore()?.timezone);
}
