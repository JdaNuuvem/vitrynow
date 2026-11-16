"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Deliverer, Order } from "@/core/domain/orders";
import { usePanelServices } from "@/core/services/PanelServices";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";
import { nextStatus } from "../kanban";

export function usePedidos() {
  const router = useRouter();
  const { runProtected } = useSecurityConfirm();
  const { orders: ordersGateway, deliverers: deliverersGateway, realtime } = usePanelServices();
  const [orders, setOrders] = useState<Order[]>([]);
  const [deliverers, setDeliverers] = useState<Deliverer[]>([]);

  const reload = useCallback(async () => {
    const result = await ordersGateway.list();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return;
    }
    setOrders(result.data.orders);
  }, [ordersGateway, router]);

  useEffect(() => {
    reload();
    deliverersGateway.list().then((result) => {
      if (result.ok) setDeliverers(result.data.deliverers);
    });
    return realtime.subscribe(reload);
  }, [reload, deliverersGateway, realtime]);

  const advance = useCallback(
    async (order: Order) => {
      const next = nextStatus(order.status);
      if (!next) return;
      await ordersGateway.setStatus(order.id, next);
      reload();
    },
    [ordersGateway, reload],
  );

  const assignDeliverer = useCallback(
    async (order: Order, delivererId: string) => {
      await ordersGateway.assignDeliverer(order.id, delivererId || null);
      reload();
    },
    [ordersGateway, reload],
  );

  const refund = useCallback(
    async (order: Order): Promise<string | null> => {
      const result = await runProtected("refund", (options) => ordersGateway.refund(order.id, options));
      if (!result.ok) return result.error;
      reload();
      return null;
    },
    [ordersGateway, reload, runProtected],
  );

  return { orders, deliverers, advance, assignDeliverer, refund };
}
