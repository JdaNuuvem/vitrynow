"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Coupon, NewCouponInput } from "@/core/domain/coupons";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";

// Cada ação devolve a mensagem de erro, ou null se deu certo (e a lista já foi recarregada).
export function useCupons() {
  const router = useRouter();
  const { coupons: couponsGateway } = usePanelServices();
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const current = ++version.current;
    setError(null);
    const result = await couponsGateway.list();
    if (current !== version.current) return;
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      setError(result.error);
      return;
    }
    setCoupons(result.data.coupons);
  }, [couponsGateway, router]);

  useEffect(() => {
    void reload();
    return () => { version.current += 1; };
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<HttpResult<unknown>>): Promise<string | null> => {
      const result = await action();
      if (!result.ok) {
        if (result.status === 401) router.push("/login");
        return result.error;
      }
      await reload();
      return null;
    },
    [reload, router],
  );

  return {
    coupons,
    error,
    reload,
    create: (input: NewCouponInput) => run(() => couponsGateway.create(input)),
    update: (coupon: Coupon, input: Partial<NewCouponInput>) => run(() => couponsGateway.update(coupon.id, input)),
    setActive: (coupon: Coupon, active: boolean) => run(() => couponsGateway.setActive(coupon.id, active)),
    remove: (coupon: Coupon) => run(() => couponsGateway.remove(coupon.id)),
  };
}
