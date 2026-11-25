import type { PaymentStatus } from "@meucardapio/db";
import { formatCents } from "@meucardapio/shared-types";

// Mensagem ao cliente quando o pedido é cancelado (contrato B3 §12 / GRW-15; textos: leonardo/mensagens-cancelamento-cliente.md).
// Decisão da v1: a loja NÃO edita o texto. Cada (motivo, ator) tem UMA frase fixa, escolhida aqui no servidor —
// texto livre vindo do painel nunca chega ao cliente (e não vira variável de template do WhatsApp). Funções puras.

export type MessageActor = "STORE" | "CUSTOMER" | "SYSTEM";

// Quem cancelou, a partir da origem gravada no histórico (HistorySource).
export function messageActorFor(source: "PANEL" | "CUSTOMER" | "SYSTEM" | "WEBHOOK"): MessageActor {
  return source === "CUSTOMER" ? "CUSTOMER" : source === "PANEL" ? "STORE" : "SYSTEM";
}

const STORE_MESSAGES: Record<string, string> = {
  ITEM_EM_FALTA: "Item indisponível no momento.",
  FORA_DA_AREA: "Esta loja não entrega no endereço informado.",
  LOJA_SEM_CAPACIDADE: "A loja não conseguiu atender este pedido agora.",
  CLIENTE_DESISTIU: "Cancelamento solicitado por você.",
  NAO_ATENDEU_ENDERECO: "Não foi possível confirmar o pedido ou localizar o endereço.",
  DUPLICADO_OU_ERRO: "Pedido cancelado pela loja.", // o motivo real fica só no painel
  OUTRO: "Pedido cancelado pela loja.", // a nota do dono é interna
  AGENDAMENTO_NAO_ATENDIDO: "A loja não conseguiu atender no horário agendado.",
  ESTORNO_MANUAL: "Pedido cancelado pela loja.", // API-65: a linha de dinheiro diz que foi estornado
  // API-61 (RN-ABD-04): estorno encerrado sem devolução automática. NUNCA promete devolução; a linha de dinheiro some (moneyLineFor).
  ESTORNO_NAO_CONCLUIDO: "Seu pedido foi cancelado. A loja entrará em contato sobre a devolução.",
};

const SYSTEM_MESSAGES: Record<string, string> = {
  PAGAMENTO_NAO_APROVADO: "O pagamento não foi aprovado e o pedido foi cancelado.",
  PAGAMENTO_APOS_CANCELAMENTO: "O pagamento chegou depois do cancelamento do pedido.",
  LOJA_INDISPONIVEL: "A loja ficou indisponível e o pedido foi cancelado.",
  // Motivo criado na API-03; frase APROVADA (Leonardo + Ogilvy, CA-MC-15): só depois de o provedor CONFIRMAR o estorno, e a
  // linha de dinheiro é sempre a de "estornado" (nunca a de "em andamento").
  PAGAMENTO_ESTORNADO_NO_PROVEDOR: "O pagamento foi estornado e o pedido foi cancelado.",
};

const CUSTOMER_MESSAGES: Record<string, string> = {
  CLIENTE_DESISTIU: "Você cancelou este pedido.",
};

export const ALL_CUSTOMER_MESSAGES = { STORE_MESSAGES, SYSTEM_MESSAGES, CUSTOMER_MESSAGES };

const FALLBACK = "O pedido foi cancelado.";

export function customerMessageFor(reasonCode: string | null | undefined, actor: MessageActor): string {
  if (!reasonCode) return FALLBACK;
  const table = actor === "CUSTOMER" ? CUSTOMER_MESSAGES : actor === "SYSTEM" ? SYSTEM_MESSAGES : STORE_MESSAGES;
  return table[reasonCode] ?? FALLBACK;
}

export function formatBRL(cents: number): string {
  return formatCents(cents);
}

// Linha de dinheiro, montada pelo sistema com o valor REAL do pagamento (nunca digitado) e SEM prometer prazo.
// Só existe quando havia dinheiro online; devolve null nos demais casos (dinheiro/cartão na entrega, cobrança
// que ainda pode ser paga porque o cancelamento no provedor falhou, etc.).
export function moneyLineFor(payment: { status: PaymentStatus; amountCents: number; refundAbandonedAt?: Date | null } | null | undefined, reasonCode: string | null | undefined): string | null {
  if (!payment) return null;
  if (payment.refundAbandonedAt) return null; // API-61: o estorno foi encerrado sem devolução; "em andamento" seria falso e "estornado" também
  const value = formatBRL(payment.amountCents);
  switch (payment.status) {
    case "ESTORNO_PENDENTE":
      // A falha técnica nunca aparece ao cliente: tentativa repetida também é "em andamento".
      return reasonCode === "PAGAMENTO_APOS_CANCELAMENTO" ? `O valor de ${value} será estornado.` : `O estorno de ${value} está em andamento.`;
    case "REEMBOLSADO":
      return `O valor de ${value} foi estornado. O prazo para aparecer depende do seu banco.`;
    case "CANCELADO":
    case "EXPIRADO":
      // Só com a cobrança confirmada como encerrada: se o cancelamento no provedor falhou o status segue PENDENTE (sem linha).
      // Afirma só o ESTADO ATUAL (não "nenhuma cobrança foi feita"): com a exceção CANCELADO→APROVADO da API-03 o
      // cliente pode ter pago no mesmo instante, e aí a linha de estorno (caso D) passa a valer.
      return "Não há cobrança em aberto.";
    default:
      return null;
  }
}
