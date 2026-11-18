import type { OrderStatus, OrderType, PaymentStatus } from "@meucardapio/db";

// Máquina de estados do pedido (ADR-0007 §3) — única tabela de arestas do sistema. Funções
// puras: sem banco, sem relógio implícito. O servidor decide; a UI só desenha `allowedTransitions`.

export type Role = "OWNER" | "STAFF";
export const FINAL_STATUSES: readonly OrderStatus[] = ["CONCLUIDO", "CANCELADO"];
export const UNDO_WINDOW_MS = 2 * 60 * 1000;

// Motivos de cancelamento escolhidos por pessoas. PAGAMENTO_NAO_APROVADO é só do sistema.
export const HUMAN_REASON_CODES = [
  "CLIENTE_DESISTIU",
  "NAO_ATENDEU_ENDERECO",
  "ITEM_EM_FALTA",
  "FORA_DA_AREA",
  "LOJA_SEM_CAPACIDADE",
  "DUPLICADO_OU_ERRO",
  "AGENDAMENTO_NAO_ATENDIDO", // PRO (pedido agendado)
  "OUTRO",
] as const;
export const SYSTEM_REASON_CODES = [
  "PAGAMENTO_NAO_APROVADO",
  "PAGAMENTO_APOS_CANCELAMENTO",
  "PAGAMENTO_ESTORNADO_NO_PROVEDOR",
  "LOJA_INDISPONIVEL", // entrada em Suspensão (API-09)
] as const;

export type AdvanceTarget = Exclude<OrderStatus, "PENDENTE" | "CANCELADO">;

type OrderFacts = {
  status: OrderStatus;
  type: OrderType;
  awaitingPayment: boolean;
  payment?: { status: PaymentStatus } | null;
};

// Próximo passo "para frente" (uma única aresta por estado/tipo).
export function nextAdvance(order: Pick<OrderFacts, "status" | "type">): AdvanceTarget | null {
  switch (order.status) {
    case "PENDENTE":
      return "CONFIRMADO";
    case "CONFIRMADO":
      return "EM_PREPARO";
    case "EM_PREPARO":
      return "PRONTO";
    case "PRONTO":
      return order.type === "DELIVERY" ? "SAIU_PARA_ENTREGA" : "CONCLUIDO";
    case "SAIU_PARA_ENTREGA":
      return order.type === "DELIVERY" ? "CONCLUIDO" : null;
    default:
      return null;
  }
}

export function isAdvanceAllowed(order: OrderFacts, to: OrderStatus): boolean {
  if (nextAdvance(order) !== to) return false;
  if (order.status === "PENDENTE" && order.awaitingPayment) return false;
  return true;
}

// Dinheiro online já recebido (ou com estorno em curso): cancelar exige a saga de estorno.
export function holdsMoney(payment?: { status: PaymentStatus } | null): boolean {
  return payment?.status === "APROVADO" || payment?.status === "ESTORNO_PENDENTE";
}

export type Actor = "OWNER" | "STAFF" | "CUSTOMER" | "SYSTEM";

// Quem pode cancelar o pedido no estado atual (B3.2 do Leonardo).
export function canCancel(order: OrderFacts, actor: Actor): boolean {
  if (FINAL_STATUSES.includes(order.status)) return false;
  switch (actor) {
    case "OWNER":
    case "SYSTEM":
      return true;
    case "STAFF":
      return (order.status === "PENDENTE" || order.status === "CONFIRMADO") && !holdsMoney(order.payment);
    case "CUSTOMER":
      return order.status === "PENDENTE";
  }
}

export type AllowedTransition = {
  to: OrderStatus;
  label: string;
  kind: "ADVANCE" | "CANCEL";
  primary?: boolean;
  requires?: { reason: boolean; owner: boolean; mfa: boolean; refund: boolean };
};

// Rótulos fixados pela Da Vinci (02 §2/§11). Dependem do destino e do tipo do pedido.
function advanceLabel(order: Pick<OrderFacts, "status" | "type">, to: AdvanceTarget): string {
  switch (to) {
    case "CONFIRMADO":
      return "Aceitar";
    case "EM_PREPARO":
      return "Iniciar preparo";
    case "PRONTO":
      return "Pronto";
    case "SAIU_PARA_ENTREGA":
      return "Saiu para entrega";
    case "CONCLUIDO":
      if (order.type === "DELIVERY") return "Concluir (entregue)";
      return order.type === "MESA" ? "Entregue na mesa" : "Concluir";
  }
}

function cancelLabel(order: Pick<OrderFacts, "status" | "payment">): string {
  const refund = holdsMoney(order.payment);
  if (order.status === "PENDENTE") return refund ? "Recusar e estornar" : "Recusar";
  return refund ? "Cancelar e estornar" : "Cancelar";
}

// Por que um botão NÃO está disponível para este usuário (a UI desenha desabilitado, com o texto do
// catálogo do Leonardo — nunca mostra o código). Contrato B3 §9: UM motivo por transição, o mais
// específico, nesta ordem. OWNER só recebe REFUND_PENDING, AWAITING_PAYMENT e ORDER_ALREADY_RECEIVED.
export const BLOCK_REASONS = [
  "REFUND_PENDING",
  "AWAITING_PAYMENT",
  "ORDER_ALREADY_RECEIVED", // mesa já recebida (ADR-0012 I8) — entra com a API-22/27
  "CASH_CLOSED_OWNER_ONLY", // caixa fechado — entra com a API-59
  "REFUND_REQUIRES_OWNER",
  "CANCEL_AFTER_PREP_OWNER_ONLY",
  "UNDO_WINDOW_EXPIRED",
  "FORBIDDEN_ROLE",
] as const;
export type BlockedReason = (typeof BLOCK_REASONS)[number];
export type BlockedTransition = { to: OrderStatus; kind: "ADVANCE" | "CANCEL" | "UNDO"; reason: BlockedReason };

const IN_PREPARATION: readonly OrderStatus[] = ["EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA"];

export function allowedTransitions(order: OrderFacts, role: Role): AllowedTransition[] {
  const list: AllowedTransition[] = [];
  const refundPending = order.payment?.status === "ESTORNO_PENDENTE";
  const next = nextAdvance(order);
  if (next && !refundPending && isAdvanceAllowed(order, next)) {
    list.push({ to: next, label: advanceLabel(order, next as AdvanceTarget), kind: "ADVANCE", primary: true });
  }
  // Com estorno em curso só existe "Tentar estorno" (rota própria): não cancela de novo.
  if (!refundPending && canCancel(order, role)) {
    const refund = holdsMoney(order.payment);
    list.push({
      to: "CANCELADO",
      label: cancelLabel(order),
      kind: "CANCEL",
      requires: { reason: true, owner: refund, mfa: refund, refund },
    });
  }
  return list;
}

export function blockedTransitions(order: OrderFacts, role: Role): BlockedTransition[] {
  if (FINAL_STATUSES.includes(order.status)) return [];
  const blocked: BlockedTransition[] = [];
  const refundPending = order.payment?.status === "ESTORNO_PENDENTE";
  const next = nextAdvance(order);

  if (next) {
    if (refundPending) blocked.push({ to: next, kind: "ADVANCE", reason: "REFUND_PENDING" });
    else if (!isAdvanceAllowed(order, next)) blocked.push({ to: next, kind: "ADVANCE", reason: "AWAITING_PAYMENT" });
  }

  if (refundPending) {
    blocked.push({ to: "CANCELADO", kind: "CANCEL", reason: "REFUND_PENDING" });
  } else if (!canCancel(order, role)) {
    // Só STAFF chega aqui (OWNER cancela qualquer pedido ativo). Mais específico primeiro.
    const reason: BlockedReason = holdsMoney(order.payment)
      ? "REFUND_REQUIRES_OWNER"
      : IN_PREPARATION.includes(order.status)
        ? "CANCEL_AFTER_PREP_OWNER_ONLY"
        : "FORBIDDEN_ROLE";
    blocked.push({ to: "CANCELADO", kind: "CANCEL", reason });
  }
  return blocked;
}

// Desfazer: só a última ação "para frente" (nunca a partir de estado final nem de cancelamento).
export function undoUntil(lastChangeAt: Date, role: Role): Date | null {
  return role === "OWNER" ? null : new Date(lastChangeAt.getTime() + UNDO_WINDOW_MS);
}
