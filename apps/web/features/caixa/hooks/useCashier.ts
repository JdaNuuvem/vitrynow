"use client";

import { useCallback, useEffect, useState } from "react";
import type { CashMovementType, CashierState } from "@/core/domain/cashier";
import { usePanelServices } from "@/core/services/PanelServices";

type ActionResult = string | null;

export function useCashier() {
  const { cashier } = usePanelServices();
  const [state, setState] = useState<CashierState | null>(null);

  const reload = useCallback(async () => {
    const result = await cashier.getCurrent();
    if (result.ok) setState(result.data);
  }, [cashier]);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<{ ok: boolean; error?: string }>): Promise<ActionResult> => {
      const result = await action();
      if (!result.ok) return result.error ?? "Não foi possível concluir a ação.";
      await reload();
      return null;
    },
    [reload],
  );

  return {
    state,
    open: (openingBalanceCents: number, notes?: string) => run(() => cashier.open(openingBalanceCents, notes)),
    close: (closingBalanceCents: number, notes?: string) => run(() => cashier.close(closingBalanceCents, notes)),
    addMovement: (type: CashMovementType, amountCents: number, notes: string) =>
      run(() => cashier.addMovement({ type, amountCents, notes })),
  };
}
