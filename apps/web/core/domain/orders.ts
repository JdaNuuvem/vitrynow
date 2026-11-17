export type OrderType = "MESA" | "DELIVERY" | "BALCAO";

// Lista como valor de execução: os testes percorrem o enum inteiro para garantir que nenhum pedido
// some do quadro (contrato B3 §10). SAIU_PARA_ENTREGA entra com a API-02 (contrato B3 §7 item 8).
export const ORDER_STATUSES = ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO", "CANCELADO"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderItem = { id: string; quantity: number; productName: string };

export type PaymentStatus = "PENDENTE" | "APROVADO" | "REJEITADO" | "EXPIRADO" | "REEMBOLSADO" | "ESTORNO_PENDENTE";

// ---- contrato B3 (atlas\contratos\b3-estados-e-cancelamento.md §1, §8, §9) ----
// Todos os campos abaixo são OPCIONAIS no tipo: a API atual não os envia ainda, e a tela precisa
// continuar funcionando com ela. Com a API-02, eles passam a mandar nos botões.

export type TransitionKind = "ADVANCE" | "CANCEL";

export type AllowedTransition = {
  to: OrderStatus;
  label: string;
  kind: TransitionKind;
  primary?: boolean;
  // `refund`: o botão é "Cancelar e estornar R$ X" (só dono, PIX aprovado).
  requires?: { reason?: boolean; owner?: boolean; mfa?: boolean; refund?: boolean };
};

// Códigos estáveis dos motivos de bloqueio (§9). O front NUNCA mostra o código, só o texto do catálogo.
export type BlockedReasonCode =
  | "REFUND_PENDING"
  | "AWAITING_PAYMENT"
  | "ORDER_ALREADY_RECEIVED"
  | "CASH_CLOSED_OWNER_ONLY"
  | "REFUND_REQUIRES_OWNER"
  | "CANCEL_AFTER_PREP_OWNER_ONLY"
  | "UNDO_WINDOW_EXPIRED"
  | "FORBIDDEN_ROLE";

export type BlockedTransition = { to: OrderStatus; reason: BlockedReasonCode };

export type OrderPayment = {
  status: PaymentStatus;
  refundPending?: boolean;
  refundLastError?: string | null;
};

export type Order = {
  id: string;
  code: string;
  type: OrderType;
  status: OrderStatus;
  customerName: string | null;
  totalCents: number;
  items: OrderItem[];
  delivererId: string | null;
  payment: OrderPayment | null;
  awaitingPayment?: boolean;
  allowedTransitions?: AllowedTransition[];
  blocked?: BlockedTransition[];
  // Desfazer: o dono (OWNER) não tem prazo (`undoUntil` null e `canUndo` true); a equipe tem 2 min.
  canUndo?: boolean;
  undoUntil?: string | null;
  createdAt?: string;
  // Quando o pedido entrou no estado atual (ISO). A API de hoje NÃO manda este campo: sem ele a tela só
  // calcula o tempo de pedido NOVO, a partir de createdAt (lacuna registrada para o Turing).
  statusChangedAt?: string;
};

export type Deliverer = { id: string; name: string; phone: string | null; active: boolean };
