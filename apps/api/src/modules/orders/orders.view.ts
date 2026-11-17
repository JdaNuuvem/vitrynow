import type { Order, OrderItem, Payment, Deliverer } from "@meucardapio/db";

// Visão do pedido para o PAINEL (PRD-15, Nightingale API-54a). Regra geral: resposta de pedido SEMPRE por allowlist —
// o objeto é montado campo a campo, NUNCA com spread de linha do Prisma. Um campo novo na tabela não chega ao navegador
// por acidente (providerPaymentId, QR do PIX, idempotencyKey, refundContext, reconcileNote… ficam no servidor).

export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // "recente" = encerrado há menos de 24 h (Leonardo, PRD-15)

export type ContactAccess = "FULL" | "MASKED";

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

// OWNER vê contato completo; STAFF vê completo em pedido aberto ou encerrado há < 24 h e mascarado depois.
export function contactAccessFor(role: "OWNER" | "STAFF", order: { status: string }, closedAt: Date | null, now: Date): ContactAccess {
  if (role === "OWNER") return "FULL";
  const final = order.status === "CONCLUIDO" || order.status === "CANCELADO";
  if (!final) return "FULL";
  if (!closedAt) return "MASKED"; // sem data de encerramento confiável: o mais restritivo
  return now.getTime() - closedAt.getTime() < RECENT_WINDOW_MS ? "FULL" : "MASKED";
}

// A fonte é a linha completa; o que SAI é decidido campo a campo em toPanelOrder (a allowlist é a barreira).
export type PanelOrderSource = Order & {
  items: OrderItem[];
  deliverer: Deliverer | null;
  payment: Payment | null;
};

export type PanelOrderExtras = {
  /** Quando o pedido entrou no status atual (última linha do histórico; sem histórico, a criação). */
  statusChangedAt: Date;
  /** Hora do SERVIDOR no momento da resposta: o card mede "há N min" por ela, não pelo relógio do navegador (API-62). */
  serverNow: Date;
  allowedTransitions: unknown;
  blocked: unknown;
  canUndo: boolean;
  undoUntil: string | null;
  cancel: unknown;
};

// `detail` = true devolve o contato conforme `access`; na lista (detail=false) o endereço NUNCA vai e o telefone vai
// só mascarado, qualquer que seja o papel.
export function toPanelOrder(
  order: PanelOrderSource,
  extras: PanelOrderExtras,
  opts: { detail: boolean; access: ContactAccess; contactUnavailable?: "AUDIT_UNAVAILABLE" | null },
) {
  const full = opts.detail && opts.access === "FULL";
  return {
    id: order.id,
    code: order.code,
    type: order.type,
    status: order.status,
    awaitingPayment: order.awaitingPayment,
    customerName: order.customerName,
    // Contato: lista = telefone mascarado e sem endereço; detalhe = completo ou mascarado conforme papel e idade.
    customerPhone: full ? order.customerPhone : maskPhone(order.customerPhone),
    hasPhone: !!order.customerPhone,
    address: full ? order.address : null,
    hasAddress: !!order.address,
    contactMasked: !full,
    // Só no detalhe, e só quando o contato foi negado por não poder registrar o acesso (falha fechada, API-54b).
    ...(opts.contactUnavailable ? { contactUnavailable: opts.contactUnavailable } : {}),
    notes: order.notes, // alergia/restrição aparece inteira (PRD-15)
    // Observação INTERNA (API-54): só no detalhe do painel; nunca na lista, no tíquete nem para o cliente.
    ...(opts.detail ? { internalNote: order.internalNote } : {}),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    deliveryFeeCents: order.deliveryFeeCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    paymentMethod: order.paymentMethod,
    changeForCents: order.changeForCents,
    delivererId: order.delivererId,
    deliverer: order.deliverer ? { id: order.deliverer.id, name: order.deliverer.name } : null,
    printedAt: order.printedAt,
    createdAt: order.createdAt,
    statusChangedAt: extras.statusChangedAt,
    serverNow: extras.serverNow,
    updatedAt: order.updatedAt,
    canceledAt: order.canceledAt,
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      notes: item.notes,
    })),
    // Pagamento: só o que a tela precisa. Nada de id do provedor, QR, chave de idempotência nem contexto de estorno.
    payment: order.payment && {
      status: order.payment.status,
      amountCents: order.payment.amountCents,
      expiresAt: order.payment.expiresAt,
      refundPending: order.payment.status === "ESTORNO_PENDENTE",
      reconcileRequired: !!order.payment.reconcileNote,
    },
    allowedTransitions: extras.allowedTransitions,
    blocked: extras.blocked,
    canUndo: extras.canUndo,
    undoUntil: extras.undoUntil,
    cancel: extras.cancel,
  };
}
