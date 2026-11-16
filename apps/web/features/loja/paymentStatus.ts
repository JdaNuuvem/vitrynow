import type { PaymentStatusResponse } from "@/core/domain/storefront";

// Resultado de uma consulta de status do PIX. "PENDING" = continuar perguntando.
export type PaymentOutcome =
  | { kind: "PENDING" }
  | { kind: "PAID" }
  | { kind: "FAILED"; message: string };

// Estados finais de pagamento que NÃO são sucesso (ADR-0007 §3.2).
const FAILED_PAYMENT_MESSAGES: Record<string, string> = {
  EXPIRADO: "O tempo do PIX acabou e o pagamento não foi feito. O pedido não foi concluído.",
  REJEITADO: "O pagamento não foi aprovado. O pedido não foi concluído.",
  CANCELADO: "O pagamento foi cancelado. O pedido não foi concluído.",
  CONTESTADO: "O pagamento foi contestado. Fale com a loja.",
  REEMBOLSADO: "O pagamento foi devolvido. O pedido não foi concluído.",
};

const ORDER_CANCELLED_MESSAGE = "A loja cancelou este pedido.";
const UNKNOWN_STATE_MESSAGE = "Não foi possível confirmar este pedido. Fale com a loja.";

// Decide o que a tela mostra. Regras (B15):
//  - falha SEMPRE vence "awaitingPayment=false": um pedido cancelado ou um PIX expirado também
//    deixam de aguardar pagamento, mas não foram pagos;
//  - só "APROVADO" (ou resposta antiga sem paymentStatus) vira pago;
//  - `terminal` (servidor) encerra o acompanhamento; sem ele, o front deduz dos estados.
export function interpretPaymentStatus(status: PaymentStatusResponse): PaymentOutcome {
  const customerMessage = status.cancelReason?.customerMessage?.trim() || null;

  if (status.orderStatus === "CANCELADO") {
    return { kind: "FAILED", message: customerMessage ?? ORDER_CANCELLED_MESSAGE };
  }
  if (status.paymentStatus && FAILED_PAYMENT_MESSAGES[status.paymentStatus]) {
    return { kind: "FAILED", message: customerMessage ?? FAILED_PAYMENT_MESSAGES[status.paymentStatus] };
  }
  if (status.paymentStatus === "APROVADO") return { kind: "PAID" };
  if (status.paymentStatus == null && status.awaitingPayment === false) return { kind: "PAID" }; // API antiga
  if (status.terminal === true) {
    // Terminal sem motivo conhecido (a API ganhou um estado novo antes da tela): não afirmar pagamento
    // e não afirmar que a loja cancelou. Texto neutro.
    return { kind: "FAILED", message: customerMessage ?? UNKNOWN_STATE_MESSAGE };
  }
  return { kind: "PENDING" };
}
