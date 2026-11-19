"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CashClosingResult, CashCloseInput, CashMovementInput, CashierState } from "@/core/domain/cashier";
import { usePanelServices } from "@/core/services/PanelServices";

type ActionResult = string | null;

export function useCashier() {
  const { cashier } = usePanelServices();
  const [state, setState] = useState<CashierState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastClosing, setLastClosing] = useState<CashClosingResult | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const request = ++version.current;
    const result = await cashier.getCurrent();
    if (request !== version.current) return;
    if (result.ok) {
      setState(result.data);
      setError(null);
    } else {
      if ([401, 403].includes(result.status)) setState(null);
      setError(result.error);
    }
  }, [cashier]);

  useEffect(() => {
    void reload();
    return () => { version.current++; };
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<{ ok: boolean; error?: string; status?: number }>): Promise<ActionResult> => {
      const result = await action();
      if (!result.ok) {
        if (result.status === 409) await reload();
        return result.error ?? "Não foi possível concluir a ação.";
      }
      await reload();
      return null;
    },
    [reload],
  );

  return {
    state,
    error,
    reload,
    lastClosing,
    dismissClosing: () => setLastClosing(null),
    previewClose: (countedCents: number) => cashier.previewClose(countedCents),
    dismissRuleNotice: (id: string) => run(() => cashier.dismissRuleNotice(id)),
    open: async (openingBalanceCents: number, notes?: string) => {
      const failure = await run(() => cashier.open(openingBalanceCents, notes));
      if (!failure) setLastClosing(null);
      return failure;
    },
    close: (input: CashCloseInput) => run(async () => {
      const outcome = await cashier.close(input);
      if (outcome.ok) {
        setLastClosing(outcome.data);
        setState((previous) => previous ? { ...previous, session: null, summary: undefined } : null);
      }
      return outcome;
    }),
    addMovement: (input: CashMovementInput, idempotencyKey: string) =>
      run(() => cashier.addMovement(input, { headers: { "Idempotency-Key": idempotencyKey } })),
  };
}
