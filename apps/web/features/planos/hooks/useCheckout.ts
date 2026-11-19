"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckoutStatus, PixCheckout } from "@/core/domain/subscription";
import { usePanelServices } from "@/core/services/PanelServices";

const POLL_INTERVAL_MS = 4000;

export function useCheckout(onApproved: () => void) {
  const { subscription: gateway } = usePanelServices();
  const [payment, setPayment] = useState<PixCheckout | null>(null);
  const [status, setStatus] = useState<CheckoutStatus>("PENDENTE");
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<{ error: string; code?: string } | null>(null);
  const running = useRef(false);
  const generation = useRef(0);

  const start = useCallback(
    async (planCode: string) => {
      if (running.current) return;
      running.current = true;
      const attempt = ++generation.current;
      setStarting(true);
      setFailure(null);
      setPayment(null);
      try {
        const result = await gateway.checkout(planCode);
        if (attempt !== generation.current) return;
        if (!result.ok) return setFailure(result);
        setStatus("PENDENTE");
        setPayment(result.data.payment);
      } catch {
        if (attempt === generation.current) setFailure({ error: "Não foi possível gerar o Pix. Tente novamente." });
      } finally {
        running.current = false;
        setStarting(false);
      }
    },
    [gateway],
  );

  const reset = useCallback(() => {
    generation.current++;
    setPayment(null);
    setFailure(null);
  }, []);

  useEffect(() => {
    if (!payment || status !== "PENDENTE") return;
    const paymentId = payment.id;
    const attempt = generation.current;
    let active = true;
    let timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    async function poll() {
      const result = await gateway.getPayment(paymentId).catch(() => null);
      if (!active || attempt !== generation.current) return;
      if (!result?.ok || result.data.status === "PENDENTE") {
        timer = window.setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }
      setStatus(result.data.status);
      if (result.data.status === "APROVADO") onApproved();
    }
    return () => { active = false; window.clearTimeout(timer); };
  }, [gateway, payment, status, onApproved]);

  return { payment, status, starting, error: failure?.error, errorCode: failure?.code, start, reset };
}
