import type { Order, PaymentStatus } from "./orders";

// Detalhe do pedido no painel (GET /api/orders/:id, API-54a, PRD-15). O SERVIDOR já aplicou a máscara por papel e por
// idade do pedido: quando `contactMasked` é verdadeiro, `customerPhone` vem mascarado e `address` vem nulo.
// A tela mostra o que chegou; nunca decide o que o papel pode ver.

export type OrderPaymentMethod = "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO" | "VR" | "VA";

export type DetailItem = {
  id: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  // Observação do item ("sem cebola"), em linha própria. As opções escolhidas ainda não vêm separadas (API-15).
  notes: string | null;
};

export type DetailPayment = {
  status: PaymentStatus;
  amountCents: number;
  expiresAt: string | null;
  refundPending: boolean;
  reconcileRequired: boolean;
};

// Quem cancelou e por quê (só em pedido cancelado). `by` é o PAPEL (nunca o e-mail).
export type DetailCancel = {
  reasonCode: string | null;
  reasonText: string | null;
  customerMessage: string | null;
  at: string;
  by: "OWNER" | "STAFF" | "CUSTOMER" | "SYSTEM" | string;
};

export type OrderDetail = Omit<Order, "items" | "payment"> & {
  items: DetailItem[];
  customerPhone: string | null;
  hasPhone: boolean;
  address: string | null;
  hasAddress: boolean;
  contactMasked: boolean;
  notes: string | null;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  paymentMethod: OrderPaymentMethod | null;
  changeForCents: number | null;
  deliverer: { id: string; name: string } | null;
  printedAt: string | null;
  updatedAt: string;
  canceledAt: string | null;
  payment: DetailPayment | null;
  cancel: DetailCancel | null;
};
