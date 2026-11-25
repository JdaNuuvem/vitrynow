"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReportSummary } from "@/core/domain/reports";
import { usePanelServices } from "@/core/services/PanelServices";
import { defaultRange, toReportRange, type DateRange } from "../dateRange";
import { useStoreTimezone } from "@/features/shell/useStoreTimezone";

type Result = {
  key: string;
  summary?: ReportSummary;
  updatedAt?: Date;
  error?: string;
  loading: boolean;
};

export function useRelatorios() {
  const router = useRouter();
  const { reports } = usePanelServices();
  const timeZone = useStoreTimezone();
  const [range, setRange] = useState<DateRange>(() => defaultRange(new Date(), timeZone));
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = [range.from, range.to].join("/");

  useEffect(() => {
    let active = true;
    const bounds = toReportRange(range, timeZone);
    if (!Number.isFinite(bounds.from.getTime()) || !Number.isFinite(bounds.to.getTime()) || bounds.from > bounds.to) {
      setResult({ key, loading: false, error: "Informe um período com a data inicial anterior ou igual à final." });
      return;
    }
    setResult((prev) => ({ ...(prev?.key === key ? prev : {}), key, loading: true, error: undefined }));
    const failed = () => {
      if (active) setResult((prev) => ({ ...prev, key, loading: false, error: "Falha ao atualizar o relatório." }));
    };
    async function load() {
      try {
        const response = await reports.getSummary(bounds);
        if (!active) return;
        if (response.ok) {
          setResult({ key, summary: response.data, updatedAt: new Date(), loading: false });
        } else if (response.status >= 400 && response.status < 500) {
          setResult({ key, loading: false, error: response.error || "Acesso ao relatório indisponível." });
          if (response.status === 401) router.push("/login");
        } else {
          failed();
        }
      } catch {
        failed();
      }
    }
    void load();
    return () => { active = false; };
  }, [key, range, reports, router, attempt, timeZone]);

  const current = result?.key === key ? result : null;
  return {
    summary: current?.summary, error: current?.error, loading: current?.loading ?? true, updatedAt: current?.updatedAt,
    range, setRange, reload: () => setAttempt((value) => value + 1),
  };
}
