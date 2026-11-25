import type { PaymentMethod } from "@/core/domain/storefront";

// Fechamento da mesa (POST /api/tables/:id/receive). Mesma conta do SERVIDOR, centavo a centavo:
// taxa = round(conta × % / 100) quando incluída; total = conta + taxa − desconto. O servidor recalcula e confere tudo;
// aqui é só para a tela mostrar o mesmo número antes de enviar.

export type PaymentPart = { key: number; method: PaymentMethod; amount: string; changeFor: string };

/** "12,34" ou "12.34" -> 1234 centavos; vazio -> 0; inválido -> null. */
export function parseMoney(raw: string): number | null {
  const text = raw.trim();
  if (!text) return 0;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function closeTotals(subtotalCents: number, serviceFeePercent: number, includeFee: boolean, discountCents: number) {
  const serviceFeeCents = includeFee ? Math.round((subtotalCents * serviceFeePercent) / 100) : 0;
  return { serviceFeeCents, totalCents: subtotalCents + serviceFeeCents - discountCents };
}

export type ReceiveBody =
  | { paymentMethod: PaymentMethod; changeForCents?: number; includeServiceFee?: boolean; discountCents?: number; expectedTotalCents: number }
  | { payments: { method: PaymentMethod; amountCents: number; changeForCents?: number }[]; includeServiceFee?: boolean; discountCents?: number; expectedTotalCents: number };

/**
 * Monta o corpo do recebimento ou devolve a mensagem do que está errado (sem chamar a API).
 * `parts` com UMA linha = pagamento único (não manda valor: a forma leva o total). Com 2 a 10 = divisão (PRO).
 */
export function buildReceiveBody(input: {
  subtotalCents: number;
  serviceFeePercent: number;
  includeFee: boolean;
  discount: string;
  parts: PaymentPart[];
}): { ok: true; body: ReceiveBody; totalCents: number } | { ok: false; error: string } {
  const discountCents = parseMoney(input.discount);
  if (discountCents === null) return { ok: false, error: "Desconto inválido." };
  const { totalCents } = closeTotals(input.subtotalCents, input.serviceFeePercent, input.includeFee, discountCents);
  if (totalCents <= 0) return { ok: false, error: "O desconto não pode zerar a conta." };
  const extras = { ...(input.includeFee ? { includeServiceFee: true } : {}), ...(discountCents > 0 ? { discountCents } : {}), expectedTotalCents: input.subtotalCents };

  const parsed = [];
  for (const part of input.parts) {
    const changeFor = parseMoney(part.changeFor);
    if (changeFor === null) return { ok: false, error: "Valor de troco inválido." };
    if (changeFor > 0 && part.method !== "DINHEIRO") return { ok: false, error: "Troco só se aplica a pagamento em dinheiro." };
    parsed.push({ method: part.method, amount: parseMoney(part.amount), changeFor });
  }

  if (parsed.length === 1) {
    const [only] = parsed;
    if (only.changeFor > 0 && only.changeFor < totalCents) return { ok: false, error: "O valor para troco precisa cobrir o total." };
    return { ok: true, totalCents, body: { paymentMethod: only.method, ...(only.changeFor > 0 ? { changeForCents: only.changeFor } : {}), ...extras } };
  }
  if (parsed.length > 10) return { ok: false, error: "Divida em no máximo 10 formas de pagamento." };
  if (parsed.some((p) => !p.amount || p.amount <= 0)) return { ok: false, error: "Informe o valor de cada forma de pagamento." };
  const paid = parsed.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  if (paid !== totalCents) return { ok: false, error: paid < totalCents ? "A soma das formas de pagamento é menor que o total." : "A soma das formas de pagamento passa do total." };
  for (const p of parsed) {
    if (p.changeFor > 0 && p.changeFor < (p.amount ?? 0)) return { ok: false, error: "O troco de uma parte em dinheiro precisa cobrir o valor dela." };
  }
  return {
    ok: true,
    totalCents,
    body: { payments: parsed.map((p) => ({ method: p.method, amountCents: p.amount!, ...(p.changeFor > 0 ? { changeForCents: p.changeFor } : {}) })), ...extras },
  };
}

/** Quanto falta (positivo) ou sobra (negativo) para fechar a divisão. */
export function remainingCents(totalCents: number, parts: PaymentPart[]): number {
  return totalCents - parts.reduce((sum, p) => sum + (parseMoney(p.amount) ?? 0), 0);
}
