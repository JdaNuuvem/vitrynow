"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReportSummary } from "@/core/domain/reports";
import { usePanelServices } from "@/core/services/PanelServices";
import { defaultRange, toReportRange, type DateRange } from "../dateRange";

// Recarrega o resumo sempre que o período muda.
export function useRelatorios() {
  const router = useRouter();
  const { reports } = usePanelServices();
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [range, setRange] = useState<DateRange>(defaultRange);

  const reload = useCallback(async () => {
    const reportRange = toReportRange(range);
    if (Number.isNaN(reportRange.from.getTime()) || Number.isNaN(reportRange.to.getTime())) return;
    const result = await reports.getSummary(reportRange);
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return;
    }
    setSummary(result.data);
  }, [reports, router, range]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { summary, range, setRange };
}
