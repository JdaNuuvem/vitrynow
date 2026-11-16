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
  "OUTRO",
] as const;
export const SYSTEM_REASON_CODES = ["PAGAMENTO_NAO_APROVADO", "PAGAMENTO_APOS_CANCELAMENTO"] as const;

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

const ADVANCE_LABEL: Record<AdvanceTarget, string> = {
  CONFIRMADO: "Aceitar",
  EM_PREPARO: "Preparar",
  PRONTO: "Pronto",
  SAIU_PARA_ENTREGA: "Saiu para entrega",
  CONCLUIDO: "Concluir",
};

export function allowedTransitions(order: OrderFacts, role: Role): AllowedTransition[] {
  const list: AllowedTransition[] = [];
  const refundPending = order.payment?.status === "ESTORNO_PENDENTE";
  const next = nextAdvance(order);
  if (next && !refundPending && isAdvanceAllowed(order, next)) {
    list.push({ to: next, label: ADVANCE_LABEL[next as AdvanceTarget], kind: "ADVANCE", primary: true });
  }
  if (canCancel(order, role)) {
    const refund = holdsMoney(order.payment);
    list.push({
      to: "CANCELADO",
      label: refund ? "Cancelar e estornar" : order.status === "PENDENTE" ? "Recusar" : "Cancelar",
      kind: "CANCEL",
      requires: { reason: true, owner: refund, mfa: refund, refund },
    });
  }
  return list;
}

// Desfazer: só a última ação "para frente" (nunca a partir de estado final nem de cancelamento).
export function undoUntil(lastChangeAt: Date, role: Role): Date | null {
  return role === "OWNER" ? null : new Date(lastChangeAt.getTime() + UNDO_WINDOW_MS);
}
