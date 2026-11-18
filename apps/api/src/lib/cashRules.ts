import { CodedError } from "../shared/errors";

// Regras do caixa (leonardo\especificacao-caixa.md §3, §4 e §8). Constantes e validações num lugar só: o servidor é a ÚNICA fonte da regra
// (a tela recebe `toleranceCents` e `reasonRequired` e nunca recalcula).

/** Tolerância da diferença no fechamento (RN-CX-16): R$ 5,00, constante no MVP (por loja fica P2). */
export const CASH_TOLERANCE_CENTS = 500;
export const CASH_REASON_TEXT_MAX = 200;

export const MOVEMENT_REASONS = {
  SUPRIMENTO: ["TROCO", "APORTE_DONO", "OUTRO"],
  SANGRIA: ["FORNECEDOR", "RETIRADA_DONO", "DESPESA_LOJA", "COFRE_BANCO", "OUTRO"],
} as const;
export const CLOSE_REASONS = ["ERRO_CONTAGEM", "TROCO_ERRADO", "MOVIMENTO_NAO_REGISTRADO", "VENDA_NAO_REGISTRADA", "DEVOLUCAO_NAO_REGISTRADA", "NAO_SEI", "OUTRO"] as const;

// Texto livre do `OUTRO`: 1 a 200 caracteres úteis, sem caracteres de controle, em uma linha. Fica no REGISTRO da movimentação/fechamento; nunca na auditoria.
export function cleanReasonText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length ? text : null;
}

function requireReason(reason: string | null | undefined, allowed: readonly string[], text: string | null | undefined, extra?: Record<string, unknown>) {
  if (!reason) throw new CodedError(400, "CASH_REASON_REQUIRED", "Informe o motivo.", extra);
  if (!allowed.includes(reason)) throw new CodedError(400, "CASH_REASON_INVALID", "Motivo inválido para esta operação.", extra);
  if (reason === "OUTRO") {
    const clean = cleanReasonText(text);
    if (!clean || clean.length > CASH_REASON_TEXT_MAX) {
      throw new CodedError(400, "CASH_REASON_INVALID", `Descreva o motivo em 1 a ${CASH_REASON_TEXT_MAX} caracteres.`, extra);
    }
    return { reason, reasonText: clean };
  }
  return { reason, reasonText: null };
}

/** Movimentação: motivo da lista do TIPO (DEVOLUCAO só o sistema cria). */
export function validateMovementReason(type: "SUPRIMENTO" | "SANGRIA", reason: string | null | undefined, text: string | null | undefined) {
  return requireReason(reason, MOVEMENT_REASONS[type], text);
}

/** Fechamento: a diferença acima da tolerância exige motivo; abaixo, o motivo é opcional (se vier, é validado). */
export function evaluateClose(differenceCents: number, reason: string | null | undefined, text: string | null | undefined) {
  const reasonRequired = Math.abs(differenceCents) > CASH_TOLERANCE_CENTS;
  const info = { reasonRequired, toleranceCents: CASH_TOLERANCE_CENTS };
  if (!reason) {
    if (reasonRequired) throw new CodedError(400, "CASH_REASON_REQUIRED", "Informe o motivo da diferença.", info);
    return { reason: null, reasonText: null, ...info };
  }
  return { ...requireReason(reason, CLOSE_REASONS, text, info), ...info };
}

/** Prévia: devolve o que a tela precisa SEM recalcular regra. */
export function closePreview(expectedCents: number, countedCents: number) {
  const differenceCents = countedCents - expectedCents;
  return { expectedCents, countedCents, differenceCents, toleranceCents: CASH_TOLERANCE_CENTS, reasonRequired: Math.abs(differenceCents) > CASH_TOLERANCE_CENTS };
}
