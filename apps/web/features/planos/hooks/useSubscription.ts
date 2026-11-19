"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanOffer, Subscription } from "@/core/domain/subscription";
import { usePanelServices } from "@/core/services/PanelServices";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";

export function useSubscription() {
  const { subscription: gateway } = usePanelServices();
  const { runProtected } = useSecurityConfirm();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<PlanOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadVersion = useRef(0);

  const reload = useCallback(async () => {
    const attempt = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const [current, offers] = await Promise.all([gateway.getSubscription(), gateway.listPlans()]);
      if (attempt !== loadVersion.current) return;
      if (current.ok) setSubscription(current.data.subscription);
      if (offers.ok) setPlans(offers.data.plans);
      if (!current.ok) setError(current.error);
      else if (!offers.ok) setError(offers.error);
    } catch {
      if (attempt === loadVersion.current) setError("Não foi possível consultar os planos. Tente novamente.");
    } finally {
      if (attempt === loadVersion.current) setLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    void reload();
    return () => { loadVersion.current += 1; };
  }, [reload]);

  const cancel = useCallback(async (): Promise<string | null> => {
    const result = await runProtected("cancel_subscription", (options) => gateway.cancel(options));
    if (!result.ok) return result.error;
    loadVersion.current++;
    setLoading(false);
    setSubscription(result.data.subscription);
    return null;
  }, [gateway, runProtected]);

  return { subscription, plans, error, loading, reload, cancel };
}
