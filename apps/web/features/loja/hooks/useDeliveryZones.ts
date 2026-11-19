import { useCallback, useEffect, useState } from "react";
import type { DeliveryZones } from "@/core/domain/storefront";
import type { StorefrontGateway } from "@/core/gateways/StorefrontGateway";

/** A API anterior usa apenas a taxa do cardápio e responde 404 nesta rota. */
export function useDeliveryZones(gateway: StorefrontGateway | undefined, slug: string, enabled: boolean) {
  const [config, setConfig] = useState<DeliveryZones | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(Boolean(enabled && gateway?.getDeliveryZones));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!enabled || !gateway?.getDeliveryZones) {
      setConfig(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    const load = async () => {
      try {
        const response = await gateway.getDeliveryZones!(slug);
        if (!active) return;
        setConfig(response.ok ? response.data : null);
        setFailed(!response.ok && response.status !== 404);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [gateway, slug, enabled, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { config, loading, failed, retry };
}
