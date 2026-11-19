"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Deliverer } from "@/core/domain/orders";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";

export function useEntregadores() {
  const router = useRouter();
  const { deliverers: gateway } = usePanelServices();
  const [deliverers, setDeliverers] = useState<Deliverer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const current = ++version.current;
    setError(null);
    const result = await gateway.list();
    if (current !== version.current) return;
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      setError(result.error);
      return;
    }
    setDeliverers(result.data.deliverers);
  }, [gateway, router]);

  useEffect(() => {
    void reload();
    return () => { version.current += 1; };
  }, [reload]);

  async function run(action: () => Promise<HttpResult<unknown>>) {
    const result = await action();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return result.error;
    }
    await reload();
    return null;
  }

  return { deliverers, error, reload,
    save: (name: string, phone: string, id?: string) => run(() => id
      ? gateway.update(id, { name, phone: phone || undefined }) : gateway.create({ name, phone: phone || undefined })),
    toggleActive: (deliverer: Deliverer) => run(() => gateway.setActive(deliverer.id, !deliverer.active)),
    remove: (id: string) => run(() => gateway.remove(id)),
  };
}
