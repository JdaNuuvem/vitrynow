import type { PaymentStatus } from "@meucardapio/db";

// Máquina de estados do pagamento (ADR-0007 §4). Só AVANÇA: qualquer aresta fora da tabela é ignorada
// e registrada (payment.regression_ignored). Funções puras.
const EDGES: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDENTE: ["EM_ANALISE", "APROVADO", "REJEITADO", "CANCELADO", "EXPIRADO"],
  EM_ANALISE: ["APROVADO", "REJEITADO", "CANCELADO"],
  APROVADO: ["ESTORNO_PENDENTE", "REEMBOLSADO", "CONTESTADO"],
  ESTORNO_PENDENTE: ["REEMBOLSADO", "CONTESTADO"],
  REJEITADO: [],
  // Exceção deliberada ao "só avança": o provedor é a verdade. Se ele diz APROVADO para uma cobrança que nós
  // cancelamos/expiramos localmente (cliente pagou no mesmo instante), o dinheiro entrou — a aprovação tardia
  // precisa existir para virar estorno automático em vez de ser ignorada com o dinheiro retido.
  CANCELADO: ["APROVADO"],
  EXPIRADO: ["APROVADO"],
  REEMBOLSADO: [],
  CONTESTADO: [],
};

export const PAYMENT_STATUSES = Object.keys(EDGES) as PaymentStatus[];

export function canMovePayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return EDGES[from].includes(to);
}

// Estados dos quais `to` é alcançável — usado no UPDATE condicional (`WHERE status IN origens`).
export function originsFor(to: PaymentStatus): PaymentStatus[] {
  return PAYMENT_STATUSES.filter((from) => canMovePayment(from, to));
}

export function isFinalPayment(status: PaymentStatus): boolean {
  return EDGES[status].length === 0;
}
