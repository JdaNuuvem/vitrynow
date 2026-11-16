import { useEffect, useState } from "react";
import type { CartLine, PixPayment } from "@/core/domain/storefront";
import { useStorefrontServices } from "@/core/services/StorefrontServices";
import { STORE_CLOSED_MESSAGE, toPlaceOrderInput, type CheckoutForm } from "../checkoutForm";
import type { PlacedOrder } from "./useOrderHistory";

export type PlacedOrderState = {
  orderId: string;
  code: string;
  pixData: PixPayment | null;
  paymentConfirmed: boolean;
  cancelled: boolean;
  cancelError: string | null;
};

const PAYMENT_POLL_MS = 3000;

// Ciclo de vida do pedido: enviar, acompanhar o PIX (polling) e cancelar. Não sabe de carrinho
// nem de telas — recebe o carrinho no submit e avisa o histórico via onPlaced.
export function useOrderFlow(slug: string, onPlaced: (order: PlacedOrder) => void) {
  const { storefront } = useStorefrontServices();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrderState | null>(null);

  useEffect(() => {
    if (!placed?.pixData || placed.paymentConfirmed || placed.cancelled) return;
    const interval = setInterval(async () => {
      const result = await storefront.isAwaitingPayment(slug, placed.orderId);
      if (result.ok && result.data.awaitingPayment === false) {
        setPlaced((prev) => (prev ? { ...prev, paymentConfirmed: true } : prev));
        clearInterval(interval);
      }
    }, PAYMENT_POLL_MS);
    return () => clearInterval(interval);
  }, [storefront, slug, placed]);

  // Devolve true se o pedido foi criado (quem chamou limpa o carrinho e fecha o checkout).
  async function submit(form: CheckoutForm, cart: CartLine[], totalCents: number): Promise<boolean> {
    if (submitting) return false;
    if (form.deliveryType === "DELIVERY" && !form.address.trim()) {
      setError("informe o endereço de entrega");
      setErrorCode(null);
      return false;
    }
    setSubmitting(true);
    setError(null);
    setErrorCode(null);
    const result = await storefront.placeOrder(slug, toPlaceOrderInput(form, cart));
    setSubmitting(false);
    if (!result.ok) {
      setError(result.code === "STORE_CLOSED" ? `${STORE_CLOSED_MESSAGE}.` : result.error);
      setErrorCode(result.code ?? null);
      return false;
    }

    onPlaced({ code: result.data.code, totalCents, placedAt: new Date().toISOString() });
    setPlaced({
      orderId: result.data.orderId,
      code: result.data.code,
      pixData: result.data.payment ?? null,
      paymentConfirmed: false,
      cancelled: false,
      cancelError: null,
    });
    return true;
  }

  async function cancel() {
    if (!placed || !confirm("Cancelar este pedido?")) return;
    const result = await storefront.cancelOrder(slug, placed.orderId);
    const failure = result.ok ? null : result.error;
    setPlaced((prev) => (prev ? { ...prev, cancelError: failure, cancelled: failure === null } : prev));
  }

  return { placed, submitting, error, errorCode, submit, cancel, back: () => setPlaced(null) };
}
