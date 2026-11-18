"use client";

import { useCallback, useEffect, useState } from "react";
import type { Order } from "@/core/domain/orders";
import { usePanelServices } from "@/core/services/PanelServices";
import { selectCurrentOrders } from "../services/currentOrders";
import { buildInicioMetrics, monthRange, weekRange, type InicioMetrics } from "../services/inicioMetrics";

const REFRESH_INTERVAL_MS = 60_000;

export function useInicioData() {
  const { reports, orders: ordersGateway } = usePanelServices();
  const [metrics, setMetrics] = useState<InicioMetrics | null>(null);
  const [currentOrders, setCurrentOrders] = useState<Order[] | null>(null);

  const load = useCallback(async () => {
    const now = new Date();
    const [month, week, orders] = await Promise.all([
      reports.getSummary(monthRange(now)),
      reports.getSummary(weekRange(now)),
      ordersGateway.list(),
    ]);
    // A lista de pedidos separa o "Aguardando aceite" do faturamento (B14.1); sem ela o número segue, com aviso na tela.
    if (month.ok && week.ok) setMetrics(buildInicioMetrics(month.data, week.data, now, orders.ok ? orders.data.orders : null));
    if (orders.ok) setCurrentOrders(selectCurrentOrders(orders.data.orders));
  }, [reports, ordersGateway]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return { metrics, currentOrders };
}
