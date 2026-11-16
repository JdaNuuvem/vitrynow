"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AuditLogEntry } from "@/core/domain/audit";
import { usePanelServices } from "@/core/services/PanelServices";

export function useAuditoria() {
  const router = useRouter();
  const { audit } = usePanelServices();
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const reload = useCallback(async () => {
    const result = await audit.list();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      if (result.status === 403) setForbidden(true);
      return;
    }
    setLogs(result.data.logs);
  }, [audit, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { logs, forbidden };
}
