"use client";

import { useCallback, useEffect, useState } from "react";
import type { Notice } from "@/core/domain/notices";
import { usePanelServices } from "@/core/services/PanelServices";

const REFRESH_INTERVAL_MS = 5 * 60_000;

export function useNotices() {
  const { notices: gateway } = usePanelServices();
  const [notices, setNotices] = useState<Notice[]>([]);

  const load = useCallback(async () => {
    const result = await gateway.list();
    if (result.ok) setNotices(result.data.notices);
  }, [gateway]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const markRead = useCallback(
    async (noticeId: string) => {
      setNotices((current) => current.map((notice) => (notice.id === noticeId ? { ...notice, read: true } : notice)));
      await gateway.markRead(noticeId);
    },
    [gateway],
  );

  return { notices, unreadCount: notices.filter((notice) => !notice.read).length, markRead };
}
