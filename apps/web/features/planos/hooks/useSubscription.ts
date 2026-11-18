"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanOffer, Subscription } from "@/core/domain/subscription";
import { usePanelServices } from "@/core/services/PanelServices";

export function useSubscription() {
  const { subscription: gateway } = usePanelServices();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<PlanOffer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [current, offers] = await Promise.all([gateway.getSubscription(), gateway.listPlans()]);
    if (current.ok) setSubscription(current.data.subscription);
    else setError(current.error);
    if (offers.ok) setPlans(offers.data.plans);
  }, [gateway]);

  useEffect(() => {
    reload();
  }, [reload]);

  const cancel = useCallback(async (): Promise<string | null> => {
    const result = await gateway.cancel();
    if (!result.ok) return result.error;
    setSubscription(result.data.subscription);
    return null;
  }, [gateway]);

  return { subscription, plans, error, reload, cancel };
}
