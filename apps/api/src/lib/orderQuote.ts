// PR-06 (b1): UMA conta de pedido para vitrine. A criação do pedido (`POST /stores/:slug/orders`) e a cotação (`POST /stores/:slug/quote`) chamam as MESMAS duas peças:
//  1) `priceItems`  — produtos da loja, disponibilidade, preço de cada linha (promoção, peso, opções: `buildOrderLines`);
//  2) `totalsFor`   — pedido mínimo, cupom, taxa de entrega (bairro, frete grátis), gorjeta e total.
// Nada aqui grava no banco nem reserva cupom: quem cria o pedido faz isso depois, na transação. As respostas de erro são EXATAMENTE as que a criação já devolvia.
import type { Coupon, Prisma } from "@meucardapio/db";
import { prisma } from "@meucardapio/db";
import type { CreateOrderInput } from "@meucardapio/shared-types";
import { applyFreeShipping } from "./deliveryZones";
import { buildOrderLines, orderMoneyFits, type OrderLine } from "./orderItems";
import { isSoldOutNow } from "./soldOut";

export const COUPON_EXHAUSTED_MESSAGE = "Esse cupom acabou.";

export type QuoteFailure = { ok: false; status: number; body: Record<string, unknown> };
type StoreRow = Prisma.StoreGetPayload<Record<string, never>>;

export type PricedItems = { ok: true; lines: OrderLine[] } | QuoteFailure;

/** Passo 1: confere os produtos da loja e precifica cada linha (servidor é a única fonte do preço). `now` é o relógio da promoção e do "esgotado hoje". */
export async function priceItems(store: Pick<StoreRow, "id">, items: CreateOrderInput["items"], now: Date): Promise<PricedItems> {
  const products = await prisma.product.findMany({
    where: { storeId: store.id, id: { in: items.map((i) => i.productId) } },
    include: { additionals: true },
  });
  if (products.length !== new Set(items.map((i) => i.productId)).size) {
    return { ok: false, status: 400, body: { error: "um ou mais produtos não existem nesta loja", code: "PRODUCT_NOT_FOUND" } };
  }
  // Produto pausado some do cardápio e não pode ser pedido por chamada direta (B08). API-17: esgotado hoje também é recusado (RN-B11-04).
  const unavailable = products.filter((p) => !p.active || isSoldOutNow(p, now));
  if (unavailable.length > 0) {
    return {
      ok: false,
      status: 400,
      body: { error: `Item indisponível no momento: ${unavailable.map((p) => p.name).join(", ")}.`, code: "ITEM_UNAVAILABLE", details: { items: unavailable.map((p) => ({ id: p.id, name: p.name })) } },
    };
  }
  const built = await buildOrderLines(store.id, products, items, now);
  return built.ok ? { ok: true, lines: built.lines } : { ok: false, status: built.status, body: built.body };
}

export type QuotedTotals = {
  ok: true;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
  coupon: Coupon | null;
  zoneSnapshot: { name: string; etaMin: number | null; etaMax: number | null } | null;
};

type TotalsInput = Pick<CreateOrderInput, "type" | "couponCode" | "tipCents" | "neighborhoodId" | "expectedDeliveryFeeCents">;

/** Passo 2: mínimo do pedido, cupom, taxa (bairro, frete grátis sobre o subtotal LÍQUIDO) e total. */
export async function totalsFor(store: StoreRow, lines: OrderLine[], input: TotalsInput, now: Date): Promise<QuotedTotals | QuoteFailure> {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const fail = (status: number, body: Record<string, unknown>): QuoteFailure => ({ ok: false, status, body });

  if (store.minOrderCents !== null && subtotalCents < store.minOrderCents) {
    return fail(400, { error: `pedido mínimo é R$ ${(store.minOrderCents / 100).toFixed(2)}` });
  }

  let coupon: Coupon | null = null;
  let discountCents = 0;
  if (input.couponCode) {
    coupon = await prisma.coupon.findUnique({ where: { storeId_code: { storeId: store.id, code: input.couponCode.trim().toUpperCase() } } });
    if (!coupon || !coupon.active) return fail(400, { error: "cupom inválido" });
    if (coupon.expiresAt && coupon.expiresAt < now) return fail(400, { error: "cupom expirado" });
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return fail(400, { error: COUPON_EXHAUSTED_MESSAGE, code: "COUPON_EXHAUSTED" });
    if (coupon.minOrderCents !== null && subtotalCents < coupon.minOrderCents) {
      return fail(400, { error: `pedido mínimo para este cupom é R$ ${(coupon.minOrderCents / 100).toFixed(2)}` });
    }
    discountCents = coupon.discountType === "PERCENT" ? Math.round((subtotalCents * coupon.discountValue) / 100) : coupon.discountValue;
    discountCents = Math.min(discountCents, subtotalCents);
  }

  // API-16 (B9): taxa por bairro, recalculada AQUI (o cliente só informa o bairro e a taxa que viu). Retirada nunca tem taxa.
  let deliveryFeeCents = 0;
  let zoneSnapshot: QuotedTotals["zoneSnapshot"] = null;
  if (input.type === "DELIVERY") {
    const zoneCount = await prisma.deliveryZone.count({ where: { storeId: store.id } });
    let baseFee = store.deliveryFeeCents; // sem bairros cadastrados: taxa única, como sempre (CA-B9-09)
    let zoneFreeFrom: number | null = null;
    if (zoneCount > 0) {
      const activeZones = () => prisma.deliveryZone.findMany({ where: { storeId: store.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, feeCents: true } });
      if (input.neighborhoodId) {
        const zone = await prisma.deliveryZone.findFirst({ where: { id: input.neighborhoodId, storeId: store.id } });
        if (!zone) return fail(400, { error: "Bairro não atendido por esta loja.", code: "NEIGHBORHOOD_NOT_FOUND" });
        if (!zone.active) {
          // bairro desativado enquanto o cliente montava o pedido: recusa com a lista atual, carrinho mantido
          return fail(400, { error: "Este bairro não está mais disponível para entrega.", code: "NEIGHBORHOOD_UNAVAILABLE", details: { zones: await activeZones() } });
        }
        baseFee = zone.feeCents;
        zoneFreeFrom = zone.freeFromCents;
        zoneSnapshot = { name: zone.name, etaMin: zone.etaMinMinutes, etaMax: zone.etaMaxMinutes };
      } else if (store.deliveryOutsideMode !== "DEFAULT_FEE") {
        return fail(400, { error: "Escolha o bairro da entrega.", code: "NEIGHBORHOOD_REQUIRED", details: { zones: await activeZones() } });
      }
    }
    // Frete grátis sobre o subtotal LÍQUIDO (itens menos desconto), RN-B9-05.
    deliveryFeeCents = applyFreeShipping(baseFee, subtotalCents - discountCents, zoneFreeFrom, store.freeShippingFromCents);
  }
  const tipCents = input.tipCents ?? 0;
  const totalCents = subtotalCents - discountCents + deliveryFeeCents + tipCents;
  if (!orderMoneyFits(totalCents)) return fail(400, { error: "O pedido excede o limite de valor. Divida em pedidos menores.", code: "ORDER_VALUE_TOO_HIGH" });
  // RN-B9-03: a taxa mudou desde que o cliente viu (ou é outra): 409 com o novo valor; a tela pede confirmação.
  if (input.expectedDeliveryFeeCents !== undefined && input.expectedDeliveryFeeCents !== deliveryFeeCents) {
    return fail(409, { error: "A taxa de entrega mudou. Confira o novo total.", code: "DELIVERY_FEE_CHANGED", details: { deliveryFeeCents, totalCents } });
  }
  return { ok: true, subtotalCents, discountCents, deliveryFeeCents, tipCents, totalCents, coupon, zoneSnapshot };
}
