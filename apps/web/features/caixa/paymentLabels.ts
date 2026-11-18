import type { PaymentBucket } from "@/core/domain/cashier";

export const PAYMENT_LABELS: Record<PaymentBucket, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CREDITO: "Crédito",
  DEBITO: "Débito",
  VR: "VR",
  VA: "VA",
  NAO_IDENTIFICADO: "Sem identificação",
};
