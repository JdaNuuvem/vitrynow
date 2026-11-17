import { useEffect, useRef, useState } from "react";
import type { CartLine, PixPayment } from "@/core/domain/storefront";
import { useStorefrontServices } from "@/core/services/StorefrontServices";
import { STORE_CLOSED_MESSAGE, toPlaceOrderInput, type CheckoutForm, type OrderSummary } from "../checkoutForm";
import { interpretPaymentStatus } from "../paymentStatus";
import { clearResume, readResume, saveResume } from "../pixResume";
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
  // O que o cliente pediu, para mostrar no resultado. Opcional: quem chama pode não ter montado.
  summary: OrderSummary | null;
  // NG-16: false = este aparelho não tem acesso ao pedido (a API não devolveu o token, ou recusou o que tinha).
  // Não dá para consultar o pagamento nem cancelar por aqui: a tela manda o cliente falar com a loja.
  trackingUnavailable: boolean;
  // WEB-33b: "none" = pedido feito nesta tela; "valid" = tela recuperada depois de recarregar, PIX ainda válido (só QR, sem
  // acompanhar nem cancelar); "expired" = recuperada com o PIX vencido. Só código, total e PIX voltam do sessionStorage.
  resume: "none" | "valid" | "expired";
  pixExpiresAt: number | null;
};

// Sem prometer telefone: a loja pública só tem WhatsApp (e nem toda loja o cadastrou). O botão do WhatsApp vem da tela, se houver.
export const TRACKING_UNAVAILABLE_MESSAGE = "Não é possível acompanhar este pedido por aqui. Fale com a loja.";
// Só em pedido PIX (em dinheiro ou cartão na entrega a frase enganaria).
export const PIX_PAID_REASSURANCE = "Se você já pagou, a loja recebe o pedido.";
export const PIX_RESUMED_MESSAGE = "Depois de pagar, a loja recebe o pedido. Se tiver dúvida, fale com a loja.";
export const PIX_EXPIRED_MESSAGE = "Este PIX venceu. Faça o pedido de novo. Se você já pagou, fale com a loja.";
export const CANCEL_UNAVAILABLE_MESSAGE = "Não é possível cancelar por aqui. Fale com a loja.";

export const PAYMENT_POLL_MS = 3000;

// Ciclo de vida do pedido: enviar, acompanhar o PIX (polling) e cancelar. Não sabe de carrinho
// nem de telas — recebe o carrinho no submit e avisa o histórico via onPlaced.
export function useOrderFlow(slug: string, onPlaced: (order: PlacedOrder) => void) {
  const { storefront } = useStorefrontServices();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrderState | null>(null);
  // NG-16: o token fica SÓ em memória, num ref: não entra no estado que a tela recebe, não vai à URL, ao localStorage
  // (o histórico guarda só código e total) nem a log. Some ao recarregar a página.
  const tokenRef = useRef<string | null>(null);
  // PIX deste pedido ainda guardado para retomada (código e prazo): a aba "Meus pedidos" só diz "a loja recebe o pedido"
  // enquanto houver um payload válido (em dúvida, omite).
  const [pendingPix, setPendingPix] = useState<{ code: string; expiresAt: number } | null>(null);

  function dropResume() {
    clearResume(slug);
    setPendingPix(null);
  }

  // Recarregou com um PIX guardado: volta ao QR (válido) ou diz que venceu. Valida o objeto inteiro (pixResume.ts).
  useEffect(() => {
    const reading = readResume(slug);
    if (!reading) return;
    if (reading.kind === "expired") {
      setPlaced((prev) =>
        prev ?? {
          orderId: "",
          code: reading.code,
          pixData: null,
          paymentConfirmed: false,
          paymentFailedMessage: null,
          cancelled: false,
          cancelError: null,
          summary: null,
          trackingUnavailable: true,
          resume: "expired",
          pixExpiresAt: null,
        },
      );
      return;
    }
    const { record } = reading;
    setPendingPix({ code: record.code, expiresAt: record.pixExpiresAt as number });
    setPlaced((prev) =>
      prev ?? {
        orderId: "", // o orderId nunca é guardado: sem ele (e sem token) esta tela não consulta nem cancela
        code: record.code,
        pixData: record.pix,
        paymentConfirmed: false,
        paymentFailedMessage: null,
        cancelled: false,
        cancelError: null,
        summary: null,
        trackingUnavailable: true,
        resume: "valid",
        pixExpiresAt: record.pixExpiresAt,
      },
    );
  }, [slug]);

  // PIX pago, falho ou cancelado: a retomada não faz mais sentido.
  const finished = Boolean(placed?.paymentConfirmed || placed?.paymentFailedMessage || placed?.cancelled);
  useEffect(() => {
    if (finished) {
      clearResume(slug);
      setPendingPix(null);
    }
  }, [finished, slug]);

  // Acompanha o PIX até um estado final (pago, expirado, rejeitado ou cancelado). Uma consulta
  // por vez (setTimeout encadeado, não setInterval: consulta lenta não empilha chamadas) e para
  // sozinho ao desmontar, ao cancelar ou quando o pedido deixa de existir.
  const orderId = placed?.orderId;
  const watching =
    Boolean(placed?.pixData) && !placed?.trackingUnavailable && !placed?.paymentConfirmed && !placed?.paymentFailedMessage && !placed?.cancelled;
  useEffect(() => {
    if (!orderId || !watching) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      const token = tokenRef.current;
      if (!token) return;
      const result = await storefront.getPaymentStatus(slug, orderId as string, token);
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
        // Com o NG-16 o 404 é o mesmo para pedido inexistente e para token recusado: não afirma que o pedido não
        // existe nem que o pagamento falhou (o cliente pode ter pago). Para de consultar e manda falar com a loja.
        setPlaced((prev) => (prev ? { ...prev, trackingUnavailable: true } : prev));
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

  // PIX na tela e ainda não resolvido: recarregar ou fechar a aba perde o QR e o "copia e cola" (o token só vive em
  // memória). Pede a confirmação padrão do navegador (sem texto próprio) até o pagamento confirmar, falhar ou cancelar.
  // Na tela recuperada (resume !== "none") recarregar é seguro: o QR volta; não precisa do aviso.
  const pixOnScreen =
    Boolean(placed?.pixData) && placed?.resume === "none" && !placed?.paymentConfirmed && !placed?.paymentFailedMessage && !placed?.cancelled;
  useEffect(() => {
    if (!pixOnScreen) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pixOnScreen]);

  // Devolve true se o pedido foi criado (quem chamou limpa o carrinho e fecha o checkout).
  async function submit(form: CheckoutForm, cart: CartLine[], totalCents: number, summary: OrderSummary | null = null): Promise<boolean> {
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
    tokenRef.current = result.data.token ?? null;
    // WEB-33b: guarda o que permite VOLTAR ao QR depois de recarregar (nunca token nem orderId).
    const parsedExpiry = result.data.payment?.expiresAt ? Date.parse(result.data.payment.expiresAt) : NaN;
    const placedAt = Date.now();
    const saved = saveResume(slug, {
      code: result.data.code,
      totalCents,
      placedAt,
      pix: result.data.payment,
      pixExpiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : null,
    });
    if (saved) setPendingPix({ code: result.data.code, expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : placedAt + 30 * 60 * 1000 });
    setPlaced({
      orderId: result.data.orderId,
      code: result.data.code,
      pixData: result.data.payment ?? null,
      paymentConfirmed: false,
      paymentFailedMessage: null,
      cancelled: false,
      cancelError: null,
      summary,
      trackingUnavailable: !result.data.token,
      resume: "none",
      pixExpiresAt: null,
    });
    return true;
  }

  // A confirmação é da tela (folha que escreve o efeito); aqui só executa. Nunca confirm() nativo.
  async function cancel() {
    if (!placed) return;
    const token = tokenRef.current;
    if (!token) {
      setPlaced((prev) => (prev ? { ...prev, cancelError: CANCEL_UNAVAILABLE_MESSAGE } : prev));
      return;
    }
    const result = await storefront.cancelOrder(slug, placed.orderId, token);
    // 404 = a API não reconhece o acesso a este pedido: não é "pedido não existe" para o cliente.
    const failure = result.ok ? null : result.status === 404 ? CANCEL_UNAVAILABLE_MESSAGE : result.error;
    setPlaced((prev) => (prev ? { ...prev, cancelError: failure, cancelled: failure === null } : prev));
  }

  function back() {
    tokenRef.current = null;
    // Quem sai da tela RECUPERADA dispensou a retomada; quem sai da tela do pedido recém-feito ainda pode recarregar e voltar ao QR.
    if (placed && placed.resume !== "none") dropResume();
    setPlaced(null);
  }

  return { placed, submitting, error, errorCode, submit, cancel, back, pendingPix };
}
