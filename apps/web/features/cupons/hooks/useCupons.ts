"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Coupon, NewCouponInput } from "@/core/domain/coupons";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";

// Cada ação devolve a mensagem de erro, ou null se deu certo (e a lista já foi recarregada).
export function useCupons() {
  const router = useRouter();
  const { coupons: couponsGateway } = usePanelServices();
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  const reload = useCallback(async () => {
    const result = await couponsGateway.list();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return;
    }
    setCoupons(result.data.coupons);
  }, [couponsGateway, router]);

  useEffect(() => {
    reload();
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
    create: (input: NewCouponInput) => run(() => couponsGateway.create(input)),
    setActive: (coupon: Coupon, active: boolean) => run(() => couponsGateway.setActive(coupon.id, active)),
    remove: (coupon: Coupon) => run(() => couponsGateway.remove(coupon.id)),
  };
}
