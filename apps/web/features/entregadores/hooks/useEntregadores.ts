"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Deliverer } from "@/core/domain/orders";
import { usePanelServices } from "@/core/services/PanelServices";

export function useEntregadores() {
  const router = useRouter();
  const { deliverers: gateway } = usePanelServices();
  const [deliverers, setDeliverers] = useState<Deliverer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await gateway.list();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return;
    }
    setDeliverers(result.data.deliverers);
  }, [gateway, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (name: string, phone: string) => {
      await gateway.create({ name, phone: phone || undefined });
      reload();
    },
    [gateway, reload],
  );

  const toggleActive = useCallback(
    async (deliverer: Deliverer) => {
      await gateway.setActive(deliverer.id, !deliverer.active);
      reload();
    },
    [gateway, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      const result = await gateway.remove(id);
      if (!result.ok) return setError(result.error);
      reload();
    },
    [gateway, reload],
  );

  return { deliverers, error, create, toggleActive, remove };
}
