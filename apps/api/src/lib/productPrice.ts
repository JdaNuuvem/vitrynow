// Produto detalhado (PD): regras PURAS de preço (sem banco, sem relógio global): o relógio entra por parâmetro (`now`), para testar a virada da promoção.
// Dinheiro em centavos inteiros, peso em gramas inteiras. O servidor é a única fonte do preço (nunca o cliente).

export type PricedProduct = {
  priceCents: number; // preço NORMAL; em produto por peso é o preço do QUILO
  promoCents: number | null;
  promoStartsAt: Date | null;
  promoEndsAt: Date | null; // EXCLUSIVO: a promoção vale enquanto início ≤ agora < fim
  saleUnit: "UN" | "KG" | "HG";
  minGrams: number;
  stepGrams: number;
  maxGrams: number;
};

/** Promoção ativa AGORA (RN-PD-02): `início ≤ agora < fim`; sem datas vale até o dono desligar. Futura ou vencida = false (sem erro). */
export function promoActive(p: Pick<PricedProduct, "promoCents" | "promoStartsAt" | "promoEndsAt">, now: Date): boolean {
  if (p.promoCents === null) return false;
  if (p.promoStartsAt && now.getTime() < p.promoStartsAt.getTime()) return false;
  if (p.promoEndsAt && now.getTime() >= p.promoEndsAt.getTime()) return false;
  return true;
}

/** Preço de venda de uma unidade (ou de um quilo) AGORA: o promocional enquanto ativo, senão o normal. */
export const effectivePriceCents = (p: PricedProduct, now: Date): number => (promoActive(p, now) ? (p.promoCents as number) : p.priceCents);

/** Valor da linha por peso (RN-PD-19): round_half_up(preço por quilo × gramas ÷ 1000), UMA vez por linha. Inteiros: nunca ponto flutuante. */
export const weightLineCents = (pricePerKgCents: number, grams: number): number => Math.floor((pricePerKgCents * grams + 500) / 1000);

export type WeightIssue = { code: "WEIGHT_OUT_OF_RANGE" | "WEIGHT_STEP_INVALID"; message: string };

/** Confere mínimo, máximo e passo (RN-PD-23). O passo conta a partir do mínimo. */
export function checkWeight(p: Pick<PricedProduct, "minGrams" | "stepGrams" | "maxGrams">, grams: number): WeightIssue | null {
  if (!Number.isInteger(grams) || grams < p.minGrams || grams > p.maxGrams) {
    return { code: "WEIGHT_OUT_OF_RANGE", message: `Escolha entre ${p.minGrams} g e ${p.maxGrams} g.` };
  }
  if ((grams - p.minGrams) % p.stepGrams !== 0) {
    return { code: "WEIGHT_STEP_INVALID", message: `O peso deve variar de ${p.stepGrams} em ${p.stepGrams} g.` };
  }
  return null;
}

/** Desconto acima de 50% (RN-PD-10/Q7): `promo × 2 < normal`, em inteiros. 50% exato NÃO é "acima". */
export const promoAboveHalf = (priceCents: number, promoCents: number): boolean => promoCents * 2 < priceCents;
