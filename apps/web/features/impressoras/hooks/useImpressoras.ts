"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { DeviceToken } from "@/core/domain/deviceTokens";
import { usePanelServices } from "@/core/services/PanelServices";

export type CreateOutcome = { status: "created"; token: string } | { status: "error"; message: string } | { status: "forbidden" };

export function useImpressoras() {
  const router = useRouter();
  const { deviceTokens } = usePanelServices();
  const [tokens, setTokens] = useState<DeviceToken[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const reload = useCallback(async () => {
    const result = await deviceTokens.list();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return;
    }
    setTokens(result.data.tokens);
  }, [deviceTokens, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (label: string): Promise<CreateOutcome> => {
      setForbidden(false);
      const result = await deviceTokens.create(label);
      if (!result.ok) {
        if (result.status === 403) {
          setForbidden(true);
          return { status: "forbidden" };
        }
        return { status: "error", message: result.error };
      }
      reload();
      return { status: "created", token: result.data.token.token };
    },
    [deviceTokens, reload],
  );

  const revoke = useCallback(
    async (id: string) => {
      const result = await deviceTokens.revoke(id);
      if (!result.ok && result.status === 403) return setForbidden(true);
      reload();
    },
    [deviceTokens, reload],
  );

  return { tokens, forbidden, create, revoke };
}
