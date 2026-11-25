// SSOT D5 — COTAÇÃO DO PEDIDO: uma função pura (sem I/O, sem zod) usada pelo SERVIDOR (que decide e grava) e pela
// VITRINE (só prévia). Toda regra nova de frete, desconto ou gorjeta entra AQUI, uma vez. As rotas continuam validando
// cupom e bairro (erros HTTP) e só passam os números já resolvidos. Não arredonda nada além do que a regra exige.

/** Frete grátis: o limiar do BAIRRO vence o da LOJA; vale sobre o subtotal LÍQUIDO (depois do desconto, RN-B9-05). */
export function applyFreeShipping(feeCents: number, netSubtotalCents: number, zoneFreeFrom: number | null | undefined, storeFreeFrom: number | null | undefined): number {
  const threshold = zoneFreeFrom ?? storeFreeFrom ?? null;
  return threshold !== null && netSubtotalCents >= threshold ? 0 : feeCents;
}

export type QuoteCoupon = { discountType: "PERCENT" | "FIXED" | string; discountValue: number };
export type QuoteDelivery = { baseFeeCents: number; zoneFreeFromCents?: number | null; storeFreeFromCents?: number | null };
export type QuoteInput = {
  lineTotalsCents: readonly number[];
  coupon?: QuoteCoupon | null;
  manualDiscountPercent?: number | null;
  delivery?: QuoteDelivery | null; // null/undefined = sem frete (retirada, mesa)
  tipCents?: number | null;
};
export type Quote = {
  subtotalCents: number;
  couponDiscountCents: number;
  manualDiscountCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
};

export function quoteOrder(input: QuoteInput): Quote {
  const subtotalCents = input.lineTotalsCents.reduce((sum, v) => sum + v, 0);
  const c = input.coupon;
  const couponDiscountCents = c
    ? Math.min(c.discountType === "PERCENT" ? Math.round((subtotalCents * c.discountValue) / 100) : c.discountValue, subtotalCents)
    : 0;
  const manualDiscountCents = input.manualDiscountPercent ? Math.round(((subtotalCents - couponDiscountCents) * input.manualDiscountPercent) / 100) : 0;
  const discountCents = Math.min(couponDiscountCents + manualDiscountCents, subtotalCents);
  const d = input.delivery;
  const deliveryFeeCents = d ? applyFreeShipping(d.baseFeeCents, subtotalCents - discountCents, d.zoneFreeFromCents, d.storeFreeFromCents) : 0;
  const tipCents = input.tipCents ?? 0;
  return { subtotalCents, couponDiscountCents, manualDiscountCents, discountCents, deliveryFeeCents, tipCents, totalCents: subtotalCents - discountCents + deliveryFeeCents + tipCents };
}
