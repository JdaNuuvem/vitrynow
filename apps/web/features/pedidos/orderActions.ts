import type { AllowedTransition, BlockedReasonCode, BlockedTransition, Order, OrderStatus } from "@/core/domain/orders";

// Regras do card de pedido (spec 02 §2, contrato B3 §1/§8/§9). Tudo puro: a tela só desenha o que
// sai daqui. A regra de negócio NÃO é duplicada no front: os botões vêm de `allowedTransitions`
// (o que o servidor aceita) e `blocked` (o que existe mas este usuário não pode, com o motivo).

// Textos do catálogo do Leonardo (leonardo\catalogo-codigos-erro.md §5b). O front nunca mostra o código.
export const BLOCK_REASON_TEXT: Record<BlockedReasonCode, string> = {
  REFUND_REQUIRES_OWNER: "Só o dono pode cancelar pedido pago.",
  CANCEL_AFTER_PREP_OWNER_ONLY: "Só o dono pode cancelar depois que o preparo começou.",
  UNDO_WINDOW_EXPIRED: "Só o dono pode voltar este pedido.",
  REFUND_PENDING: "O estorno deste pedido está em andamento.",
  AWAITING_PAYMENT: "Aguardando o pagamento do cliente.",
  CASH_CLOSED_OWNER_ONLY: "Só o dono pode cancelar pedido de caixa fechado.",
  ORDER_ALREADY_RECEIVED: "Esta mesa já foi recebida. Peça ao dono para estornar o recebimento.",
  FORBIDDEN_ROLE: "Seu perfil não permite esta ação.",
};

// Quem não é o dono não vê "Tentar estorno" habilitado: a API recusa com FORBIDDEN_ROLE (Deming, A1).
export const RETRY_REFUND_OWNER_ONLY_TEXT = "Só o dono pode tentar o estorno de novo.";

// Em pedido NOVO a recusa de pedido pago tem texto próprio ("recusar", não "cancelar").
const REFUND_REQUIRES_OWNER_ON_NEW = "Só o dono pode recusar pedido pago.";
// Código que a API devolver e que este front ainda não conhece: texto seguro, nunca o código cru.
const UNKNOWN_REASON_TEXT = "Esta ação não está disponível agora.";

export function blockReasonText(reason: string, status?: OrderStatus): string {
  if (reason === "REFUND_REQUIRES_OWNER" && status === "PENDENTE") return REFUND_REQUIRES_OWNER_ON_NEW;
  return BLOCK_REASON_TEXT[reason as BlockedReasonCode] ?? UNKNOWN_REASON_TEXT;
}

export type CardAction = {
  to: OrderStatus;
  label: string;
  kind: "ADVANCE" | "CANCEL";
  primary: boolean;
  requiresReason: boolean;
  // `refund`: a confirmação é "Cancelar e estornar R$ X" (só dono, PIX aprovado).
  refund: boolean;
  // Presente só quando o botão existe mas está desabilitado: o texto vai no botão, não o código.
  disabledReason: string | null;
};

export type CardActions = {
  // No máximo um botão principal (a próxima etapa do fluxo).
  primary: CardAction | null;
  // Recusar, para pedido novo (PENDENTE): fica ao lado do principal.
  secondary: CardAction | null;
  // Menu ⋯: cancelar em pedido já aceito.
  menu: CardAction[];
  undo: { enabled: boolean; reason: string | null };
  // Estorno pendente trava tudo menos "Tentar estorno" (RN-B3-01).
  refundPending: boolean;
};

function fromAllowed(t: AllowedTransition): CardAction {
  return {
    to: t.to,
    label: t.label,
    kind: t.kind,
    primary: Boolean(t.primary),
    requiresReason: Boolean(t.requires?.reason),
    refund: Boolean(t.requires?.refund),
    disabledReason: null,
  };
}

// Transição que existe mas está bloqueada: o servidor manda só `to` e `reason`; o rótulo vem do
// padrão por tipo (cancelar/recusar) porque a API não manda `label` em `blocked`.
function fromBlocked(b: BlockedTransition, status: OrderStatus): CardAction {
  const cancelling = b.to === "CANCELADO";
  return {
    to: b.to,
    label: cancelling ? (status === "PENDENTE" ? "Recusar" : "Cancelar") : "Avançar",
    kind: cancelling ? "CANCEL" : "ADVANCE",
    primary: false,
    requiresReason: cancelling,
    refund: false,
    disabledReason: blockReasonText(b.reason, status),
  };
}

// O estorno desse pedido já foi pedido e ainda não foi aceito. Sai do DADO do pedido (a API manda `refundPending` e o
// status ESTORNO_PENDENTE), nunca de estado local de tela: reabrir a folha depois tem de continuar de onde parou.
export function isRefundPending(order: Order): boolean {
  return Boolean(order.payment?.refundPending) || order.payment?.status === "ESTORNO_PENDENTE";
}

// API-67: em LEGACY a impressora não avisa a cozinha de um cancelamento, então o dono cancelaria comida já impressa sem
// que a cozinha saiba. A faixa só aparece com LEGACY EXPLÍCITO e `printedAt` presente: nunca em QUEUE, nunca com o campo
// ausente (API antiga) ou com valor desconhecido (em dúvida, sem faixa para não alarmar à toa).
export function kitchenNotWarned(order: Order): boolean {
  return order.printMode === "LEGACY" && Boolean(order.printedAt);
}

export function deriveCardActions(order: Order): CardActions {
  const allowed = (order.allowedTransitions ?? []).map(fromAllowed);
  const blocked = (order.blocked ?? []).map((b) => fromBlocked(b, order.status));
  const all = [...allowed, ...blocked];

  const primary = allowed.find((a) => a.primary && a.kind === "ADVANCE") ?? null;
  // Em pedido novo, "Recusar" (ou "Recusar e estornar") é o botão ao lado do principal.
  const cancels = all.filter((a) => a.kind === "CANCEL");
  const secondary = order.status === "PENDENTE" ? (cancels[0] ?? null) : null;
  const menu = order.status === "PENDENTE" ? [] : cancels;

  const refundPending = isRefundPending(order);
  const undoBlocked = (order.blocked ?? []).find((b) => b.reason === "UNDO_WINDOW_EXPIRED");

  return {
    primary,
    secondary,
    menu,
    undo: {
      enabled: Boolean(order.canUndo) && !refundPending,
      reason: refundPending
        ? BLOCK_REASON_TEXT.REFUND_PENDING
        : undoBlocked
          ? BLOCK_REASON_TEXT.UNDO_WINDOW_EXPIRED
          : null,
    },
    refundPending,
  };
}

// Rótulo do botão de confirmar da folha de cancelamento: repete o efeito e o valor, nunca "Tem certeza?".
export function confirmCancelLabel(order: Order, formatMoney: (cents: number) => string): string {
  const refund = (order.allowedTransitions ?? []).some((t) => t.kind === "CANCEL" && t.requires?.refund);
  if (refund) {
    return `${order.status === "PENDENTE" ? "Recusar e estornar" : "Cancelar e estornar"} ${formatMoney(order.totalCents)}`;
  }
  return order.status === "PENDENTE" ? "Recusar pedido" : "Cancelar pedido";
}
