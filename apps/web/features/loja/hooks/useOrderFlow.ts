import { useEffect, useState } from "react";
import type { CartLine, PixPayment } from "@/core/domain/storefront";
import { useStorefrontServices } from "@/core/services/StorefrontServices";
import { STORE_CLOSED_MESSAGE, toPlaceOrderInput, type CheckoutForm } from "../checkoutForm";
import { interpretPaymentStatus } from "../paymentStatus";
import type { PlacedOrder } from "./useOrderHistory";

export type PlacedOrderState = {
  orderId: string;
  code: string;
  pixData: PixPayment | null;
  paymentConfirmed: boolean;
  // Mensagem quando o PIX expirou/foi rejeitado ou a loja cancelou; null enquanto tudo certo.
  paymentFailedMessage: string | null;
  cancelled: boolean;
  cancelError: string | null;
};

export const PAYMENT_POLL_MS = 3000;

// Ciclo de vida do pedido: enviar, acompanhar o PIX (polling) e cancelar. Não sabe de carrinho
// nem de telas — recebe o carrinho no submit e avisa o histórico via onPlaced.
export function useOrderFlow(slug: string, onPlaced: (order: PlacedOrder) => void) {
  const { storefront } = useStorefrontServices();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrderState | null>(null);

  // Acompanha o PIX até um estado final (pago, expirado, rejeitado ou cancelado). Uma consulta
  // por vez (setTimeout encadeado, não setInterval: consulta lenta não empilha chamadas) e para
  // sozinho ao desmontar, ao cancelar ou quando o pedido deixa de existir.
  const orderId = placed?.orderId;
  const watching = Boolean(placed?.pixData) && !placed?.paymentConfirmed && !placed?.paymentFailedMessage && !placed?.cancelled;
  useEffect(() => {
    if (!orderId || !watching) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      const result = await storefront.getPaymentStatus(slug, orderId as string);
      if (stopped) return;
      if (result.ok) {
        const outcome = interpretPaymentStatus(result.data);
        if (outcome.kind === "PAID") {
          setPlaced((prev) => (prev ? { ...prev, paymentConfirmed: true } : prev));
          return;
        }
        if (outcome.kind === "FAILED") {
          setPlaced((prev) => (prev ? { ...prev, paymentFailedMessage: outcome.message } : prev));
          return;
        }
      } else if (result.status === 404) {
        setPlaced((prev) => (prev ? { ...prev, paymentFailedMessage: "Não encontramos este pedido. Fale com a loja." } : prev));
        return;
      }
      // Pendente ou falha de rede passageira: tenta de novo.
      timer = setTimeout(tick, PAYMENT_POLL_MS);
    }

    timer = setTimeout(tick, PAYMENT_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [storefront, slug, orderId, watching]);

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
      paymentFailedMessage: null,
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
