// Motivos de recusa/cancelamento (spec 02 §5.1; códigos do contrato B3 §2.2). A lista e a ordem são
// as da spec. `PAGAMENTO_NAO_APROVADO` NÃO está aqui: é só do sistema (a API devolve REASON_INVALID).

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
  // Texto sugerido ao cliente (editável). `null` = sem sugestão oficial ainda: a tela não inventa
  // texto para o cliente final. PENDENTE com Leonardo/Ogilvy (B3.3): só o de item em falta existe.
  customerMessage: string | null;
};

export const CANCEL_REASONS: readonly CancelReason[] = [
  { code: "ITEM_EM_FALTA", label: "Item em falta", customerMessage: "Item indisponível no momento." },
  { code: "FORA_DA_AREA", label: "Fora da área de entrega", customerMessage: null },
  { code: "LOJA_SEM_CAPACIDADE", label: "Loja sem capacidade agora", customerMessage: null },
  { code: "CLIENTE_DESISTIU", label: "Cliente desistiu", customerMessage: null },
  { code: "NAO_ATENDEU_ENDERECO", label: "Não atendeu / endereço não localizado", customerMessage: null },
  { code: "DUPLICADO_OU_ERRO", label: "Pedido duplicado ou erro de lançamento", customerMessage: null },
  { code: "OUTRO", label: "Outro", customerMessage: null },
];

export type CancelDraft = { code: CancelReasonCode | null; text: string; customerMessage: string };

export type CancelValidation = { ok: true } | { ok: false; hint: string };

// O botão de confirmar fica desabilitado até haver motivo (e texto, se "Outro"), e o porquê aparece
// escrito embaixo do botão (spec 02 §5.1), não só no estado desabilitado.
export function validateCancel(draft: CancelDraft): CancelValidation {
  if (!draft.code) return { ok: false, hint: "Escolha um motivo para continuar" };
  if (draft.code === "OUTRO" && draft.text.trim().length === 0) return { ok: false, hint: "Escreva o motivo para continuar" };
  return { ok: true };
}

// Corpo de POST /api/orders/:id/cancel (contrato §2.2). `acknowledgeClosedCash` só vai marcado
// quando o dono confirmou a caixa de "caixa já fechado" (API-59).
export function buildCancelBody(draft: CancelDraft, acknowledgeClosedCash = false) {
  if (!draft.code) throw new Error("motivo obrigatório");
  const text = draft.text.trim();
  const customerMessage = draft.customerMessage.trim();
  return {
    reason: {
      code: draft.code,
      ...(text ? { text } : {}),
      ...(customerMessage ? { customerMessage } : {}),
    },
    acknowledgeClosedCash,
  };
}

// Ao trocar de motivo, a mensagem ao cliente volta à sugestão do novo motivo (ou fica vazia).
export function draftForReason(code: CancelReasonCode, previous?: CancelDraft): CancelDraft {
  const found = CANCEL_REASONS.find((reason) => reason.code === code);
  return { code, text: previous?.text ?? "", customerMessage: found?.customerMessage ?? "" };
}
