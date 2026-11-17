// Motivos de recusa/cancelamento (spec 02 §5.1; códigos do contrato B3 §2.2). A lista e a ordem são
// as da spec. `PAGAMENTO_NAO_APROVADO` NÃO está aqui: é só do sistema (a API devolve REASON_INVALID).
//
// GRW-15 (contrato B3 §12): a loja NÃO edita o texto ao cliente. Cada código tem UMA frase fixa
// (leonardo\mensagens-cancelamento-cliente.md §1.1), testável e segura para o modelo do WhatsApp.
// O motivo interno e a nota de "Outro" nunca chegam ao cliente.

export type CancelReasonCode =
  | "ITEM_EM_FALTA"
  | "FORA_DA_AREA"
  | "LOJA_SEM_CAPACIDADE"
  | "CLIENTE_DESISTIU"
  | "NAO_ATENDEU_ENDERECO"
  | "DUPLICADO_OU_ERRO"
  | "OUTRO";

export type CancelReason = {
  code: CancelReasonCode;
  label: string;
  // Frase fixa que o cliente vê quando a LOJA cancela por este motivo (≤ 80 caracteres, 1 linha, sem link).
  customerPhrase: string;
};

export const CUSTOMER_PHRASE_MAX = 80;

export const CANCEL_REASONS: readonly CancelReason[] = [
  { code: "ITEM_EM_FALTA", label: "Item em falta", customerPhrase: "Item indisponível no momento." },
  { code: "FORA_DA_AREA", label: "Fora da área de entrega", customerPhrase: "Esta loja não entrega no endereço informado." },
  { code: "LOJA_SEM_CAPACIDADE", label: "Loja sem capacidade agora", customerPhrase: "A loja não conseguiu atender este pedido agora." },
  { code: "CLIENTE_DESISTIU", label: "Cliente desistiu", customerPhrase: "Cancelamento solicitado por você." },
  {
    code: "NAO_ATENDEU_ENDERECO",
    label: "Não atendeu / endereço não localizado",
    customerPhrase: "Não foi possível confirmar o pedido ou localizar o endereço.",
  },
  // O motivo real (erro de lançamento) fica só no painel: a frase não expõe erro operacional da loja.
  { code: "DUPLICADO_OU_ERRO", label: "Pedido duplicado ou erro de lançamento", customerPhrase: "Pedido cancelado pela loja." },
  { code: "OUTRO", label: "Outro", customerPhrase: "Pedido cancelado pela loja." },
];

// Escolha do dono na folha. Só o motivo e, em "Outro", a nota INTERNA (nunca vai ao cliente).
export type CancelDraft = { code: CancelReasonCode | null; text: string };

export type CancelValidation = { ok: true } | { ok: false; hint: string };

// O botão de confirmar fica desabilitado até haver motivo (e nota, se "Outro"), e o porquê aparece
// escrito embaixo do botão (spec 02 §5.1), não só no estado desabilitado.
export function validateCancel(draft: CancelDraft): CancelValidation {
  if (!draft.code) return { ok: false, hint: "Escolha um motivo para continuar" };
  if (draft.code === "OUTRO" && draft.text.trim().length === 0) return { ok: false, hint: "Escreva o motivo para continuar" };
  return { ok: true };
}

// O que o cliente vai ver, para a prévia SOMENTE LEITURA da folha. `null` sem motivo escolhido.
export function customerPhraseFor(code: CancelReasonCode | null): string | null {
  return CANCEL_REASONS.find((reason) => reason.code === code)?.customerPhrase ?? null;
}

// Corpo de POST /api/orders/:id/cancel (contrato §2.2). `acknowledgeClosedCash` só vai marcado
// quando o dono confirmou a caixa de "caixa já fechado" (API-59).
//
// INTERINO: hoje a API grava o `customerMessage` que receber (orders.service.ts) em vez de derivá-lo
// do código. Enquanto o servidor não deriva (tarefa do Turing), a tela manda a frase FIXA do catálogo,
// a mesma da prévia, para o dono ver exatamente o que o cliente verá. Quando o servidor derivar, ele
// passa a ignorar este campo e esta linha pode sair.
export function buildCancelBody(draft: CancelDraft, acknowledgeClosedCash = false) {
  if (!draft.code) throw new Error("motivo obrigatório");
  const text = draft.text.trim();
  return {
    reason: {
      code: draft.code,
      ...(draft.code === "OUTRO" && text ? { text } : {}),
      customerMessage: customerPhraseFor(draft.code) as string,
    },
    acknowledgeClosedCash,
  };
}
