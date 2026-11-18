"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PlanStatus } from "@/core/domain/store";
import { usePanelServices } from "@/core/services/PanelServices";

type PlanStatusApi = { status: PlanStatus | null; refresh: () => Promise<void> };

const PlanStatusContext = createContext<PlanStatusApi>({ status: null, refresh: async () => {} });

export function PlanStatusProvider({ children }: { children: ReactNode }) {
  const { plan } = usePanelServices();
  const [status, setStatus] = useState<PlanStatus | null>(null);

  const refresh = useCallback(async () => {
    const result = await plan.getStatus();
    if (result.ok) setStatus(result.data);
  }, [plan]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const api = useMemo(() => ({ status, refresh }), [status, refresh]);
  return <PlanStatusContext.Provider value={api}>{children}</PlanStatusContext.Provider>;
}

export function usePlanStatus(): PlanStatus | null {
  return useContext(PlanStatusContext).status;
}

export function useRefreshPlanStatus(): () => Promise<void> {
  return useContext(PlanStatusContext).refresh;
}
