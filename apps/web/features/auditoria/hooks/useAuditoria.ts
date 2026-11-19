"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditLogEntry } from "@/core/domain/audit";
import { usePanelServices } from "@/core/services/PanelServices";

export function useAuditoria() {
  const router = useRouter();
  const { audit } = usePanelServices();
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const current = ++version.current;
    setError(null);
    const result = await audit.list();
    if (current !== version.current) return;
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      if (result.status === 403) setForbidden(true);
      else setError(result.error);
      return;
    }
    setForbidden(false);
    setLogs(result.data.logs);
  }, [audit, router]);

  useEffect(() => {
    void reload();
    return () => { version.current += 1; };
  }, [reload]);

  return { logs, forbidden, error, reload };
}
