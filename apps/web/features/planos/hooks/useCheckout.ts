"use client";

import { useCallback, useEffect, useState } from "react";
import type { CheckoutStatus, PixCheckout } from "@/core/domain/subscription";
import { usePanelServices } from "@/core/services/PanelServices";

const POLL_INTERVAL_MS = 4000;

export function useCheckout(onApproved: () => void) {
  const { subscription: gateway } = usePanelServices();
  const [payment, setPayment] = useState<PixCheckout | null>(null);
  const [status, setStatus] = useState<CheckoutStatus>("PENDENTE");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (planCode: string) => {
      setStarting(true);
      setError(null);
      const result = await gateway.checkout(planCode);
      setStarting(false);
      if (!result.ok) return setError(result.error);
      setStatus("PENDENTE");
      setPayment(result.data.payment);
    },
    [gateway],
  );

  const reset = useCallback(() => {
    setPayment(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!payment || status !== "PENDENTE") return;
    const timer = window.setInterval(async () => {
      const result = await gateway.getPayment(payment.id);
      if (!result.ok || result.data.status === "PENDENTE") return;
      setStatus(result.data.status);
      if (result.data.status === "APROVADO") onApproved();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [gateway, payment, status, onApproved]);

  return { payment, status, starting, error, start, reset };
}
