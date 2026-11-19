"use client";

import { useCallback, useEffect, useState } from "react";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { monthRange, weekRange } from "../services/inicioMetrics";

const REFRESH_INTERVAL_MS = 60_000;

type Snapshot<T> = { data: T | null; error: string | null; updatedAt: Date | null };

function useSnapshot<T>(fetchData: () => Promise<HttpResult<T>>, enabled = true) {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ data: null, error: null, updatedAt: null });
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((current) => current + 1);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const result = await fetchData();
        if (!active) return;
        if (result.ok) {
          setSnapshot({ data: result.data, error: null, updatedAt: new Date() });
        } else if (result.status === 401 || result.status === 403) {
          setSnapshot({ data: null, error: "Acesso indisponível para esta conta.", updatedAt: null });
        } else {
          setSnapshot((last) => ({ ...last, error: "Não foi possível atualizar." }));
        }
      } catch {
        if (active) setSnapshot((last) => ({ ...last, error: "Não foi possível atualizar." }));
      } finally {
        loading = false;
      }
    }
    void load();
    const refreshWhenVisible = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [fetchData, attempt, enabled]);

  return { ...snapshot, retry };
}

export function useInicioData() {
  const { reports, orders } = usePanelServices();
  const loadMonth = useCallback(() => reports.getSummary(monthRange(new Date())), [reports]);
  const loadWeek = useCallback(() => reports.getSummary(weekRange(new Date())), [reports]);
  const loadOpen = useCallback(() => orders.history({ status: "ABERTO", limit: 4 }), [orders]);
  const loadWaiting = useCallback(() => orders.awaitingPayments(), [orders]);
  const loadOrders = useCallback(() => orders.list(), [orders]);
  const month = useSnapshot(loadMonth);
  const week = useSnapshot(loadWeek);
  const legacySummary = [month.data, week.data].some((data) => data && data.openCount === undefined && !data.ruleChangedAt);

  return {
    month,
    week,
    open: useSnapshot(loadOpen),
    waiting: useSnapshot(loadWaiting),
    legacyOrders: useSnapshot(loadOrders, legacySummary),
  };
}
