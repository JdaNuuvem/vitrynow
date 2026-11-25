// SSOT D5 — teste cruzado "web == servidor": o total que a API GRAVA num pedido real pelo cardápio tem de ser
// exatamente o que a função compartilhada `quoteOrder` (shared-types/quote) calcula — a MESMA que o checkout usa na prévia.
// ~20 casos: retirada e entrega, taxa única e por bairro, frete grátis da loja e do bairro (sobre o subtotal LÍQUIDO),
// cupom percentual e fixo, gorjeta.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { quoteOrder, type QuoteCoupon } from "@meucardapio/shared-types/quote";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, registerStore, resetDb } from "./helpers";

const PRICE = 5000;
type Case = {
  name: string;
  type: "DELIVERY" | "BALCAO";
  qty: number;
  tip?: number;
  coupon?: "P10" | "F1000" | "F4000";
  zone?: "centro" | "bairro";
};
const COUPONS: Record<string, QuoteCoupon & { code: string }> = {
  P10: { code: "DEZ", discountType: "PERCENT", discountValue: 10 },
  F1000: { code: "MENOS10", discountType: "FIXED", discountValue: 1000 },
  F4000: { code: "MENOS40", discountType: "FIXED", discountValue: 4000 },
};
// Loja A: taxa única R$ 8, sem frete grátis. Loja B: Centro R$ 6 (grátis a partir de R$ 120), Bairro R$ 9 (sem limiar próprio);
// frete grátis da LOJA a partir de R$ 150 (vale para o Bairro; o limiar do Centro vence o da loja).
const STORE_A = { baseFee: 800, storeFree: null as number | null };
const STORE_B = { storeFree: 15000, zones: { centro: { fee: 600, free: 12000 }, bairro: { fee: 900, free: null as number | null } } };

const CASES_A: Case[] = [
  { name: "entrega 1 item", type: "DELIVERY", qty: 1 },
  { name: "entrega 2 itens + gorjeta", type: "DELIVERY", qty: 2, tip: 500 },
  { name: "retirada 1 item + gorjeta", type: "BALCAO", qty: 1, tip: 200 },
  { name: "retirada com cupom 10%", type: "BALCAO", qty: 3, coupon: "P10" },
  { name: "entrega com cupom fixo", type: "DELIVERY", qty: 1, coupon: "F1000" },
  { name: "entrega com cupom 10% + gorjeta", type: "DELIVERY", qty: 4, coupon: "P10", tip: 1000 },
  { name: "retirada 5 itens", type: "BALCAO", qty: 5 },
  { name: "entrega cupom fixo maior que um item", type: "DELIVERY", qty: 1, coupon: "F4000" },
];
const CASES_B: Case[] = [
  { name: "Centro abaixo do limiar do bairro", type: "DELIVERY", qty: 2, zone: "centro" },
  { name: "Centro no limiar do bairro: grátis", type: "DELIVERY", qty: 3, zone: "centro" },
  { name: "Centro: cupom derruba o líquido abaixo do limiar, cobra", type: "DELIVERY", qty: 3, zone: "centro", coupon: "F4000" },
  { name: "Centro grátis + gorjeta", type: "DELIVERY", qty: 4, zone: "centro", tip: 500 },
  { name: "Bairro abaixo do limiar da loja", type: "DELIVERY", qty: 2, zone: "bairro" },
  { name: "Bairro no limiar da loja: grátis", type: "DELIVERY", qty: 3, zone: "bairro" },
  { name: "Bairro: cupom 10% derruba abaixo do limiar da loja", type: "DELIVERY", qty: 3, zone: "bairro", coupon: "P10" },
  { name: "Bairro acima do limiar com cupom 10%", type: "DELIVERY", qty: 4, zone: "bairro", coupon: "P10" },
  { name: "Bairro 1 item + gorjeta", type: "DELIVERY", qty: 1, zone: "bairro", tip: 200 },
  { name: "retirada na loja B ignora qualquer frete", type: "BALCAO", qty: 3 },
  { name: "Centro 1 item com cupom fixo", type: "DELIVERY", qty: 1, zone: "centro", coupon: "F1000" },
  { name: "Bairro 5 itens com cupom fixo + gorjeta", type: "DELIVERY", qty: 5, zone: "bairro", coupon: "F4000", tip: 1000 },
];

describe("SSOT D5 — cotação: o que a API grava == quoteOrder compartilhado (prévia do checkout)", () => {
  let app: ReturnType<typeof makeApp>;
  const json = (r: { body: string }) => JSON.parse(r.body);
  let a: { slug: string; productId: string };
  let b: { slug: string; productId: string; zones: Record<"centro" | "bairro", string> };
  let phone = 21900000000;

  async function store(slug: string, code: string, baseFee: number) {
    const { cookie } = await registerStore(app, { slug, code });
    const call = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: { cookie: cookie! }, payload: payload as never });
    await call("/api/store/settings", { deliveryFeeCents: baseFee });
    const category = json(await call("/api/catalog/categories", { name: "Lanches" })).category;
    const productId = json(await call("/api/catalog/products", { categoryId: category.id, name: "Combo", priceCents: PRICE })).product.id as string;
    for (const c of Object.values(COUPONS)) expect((await call("/api/coupons", { code: c.code, discountType: c.discountType, discountValue: c.discountValue })).statusCode).toBe(201);
    return { cookie: cookie!, call, productId };
  }

  beforeAll(async () => {
    app = makeApp();
    await app.ready();
    const sa = await store("cota-a", "QA1", STORE_A.baseFee);
    a = { slug: "cota-a", productId: sa.productId };
    const sb = await store("cota-b", "QB1", 700);
    expect((await sb.call("/api/delivery-zones/config", { freeShippingFromCents: STORE_B.storeFree })).statusCode).toBe(200);
    const centro = json(await sb.call("/api/delivery-zones", { name: "Centro", feeCents: STORE_B.zones.centro.fee, freeFromCents: STORE_B.zones.centro.free })).zone.id as string;
    const bairro = json(await sb.call("/api/delivery-zones", { name: "Bairro", feeCents: STORE_B.zones.bairro.fee })).zone.id as string;
    b = { slug: "cota-b", productId: sb.productId, zones: { centro, bairro } };
  });
  afterEach(() => resetLimits());
  afterAll(async () => {
    await app.close();
    await resetDb();
    await prisma.$disconnect();
  });

  async function check(c: Case, target: { slug: string; productId: string }, delivery: { baseFeeCents: number; zoneFreeFromCents?: number | null; storeFreeFromCents?: number | null } | null, neighborhoodId?: string) {
    const coupon = c.coupon ? COUPONS[c.coupon] : null;
    const expected = quoteOrder({ lineTotalsCents: [PRICE * c.qty], coupon, delivery: c.type === "DELIVERY" ? delivery : null, tipCents: c.tip });
    phone += 1; // cada pedido com um telefone (o teto de pendentes por telefone não interfere)
    const res = await app.inject({
      method: "POST",
      url: `/stores/${target.slug}/orders`,
      payload: {
        type: c.type, customerPhone: String(phone), paymentMethod: "DINHEIRO", items: [{ productId: target.productId, quantity: c.qty }],
        ...(c.type === "DELIVERY" ? { address: "Rua A, 10" } : {}), ...(neighborhoodId ? { neighborhoodId } : {}),
        ...(coupon ? { couponCode: coupon.code } : {}), ...(c.tip ? { tipCents: c.tip } : {}),
      },
    });
    expect(res.statusCode, `${c.name}: ${res.body}`).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: json(res).orderId } });
    expect({ subtotal: order.subtotalCents, discount: order.discountCents, fee: order.deliveryFeeCents, tip: order.tipCents, total: order.totalCents }, c.name)
      .toEqual({ subtotal: expected.subtotalCents, discount: expected.discountCents, fee: expected.deliveryFeeCents, tip: expected.tipCents, total: expected.totalCents });
    expect(json(res).totalCents, c.name).toBe(expected.totalCents);
  }

  it.each(CASES_A)("loja A (taxa única): $name", async (c) => {
    await check(c, a, { baseFeeCents: STORE_A.baseFee, storeFreeFromCents: STORE_A.storeFree });
  });

  it.each(CASES_B)("loja B (bairros + frete grátis): $name", async (c) => {
    const zone = c.zone ? STORE_B.zones[c.zone] : null;
    await check(c, b, zone ? { baseFeeCents: zone.fee, zoneFreeFromCents: zone.free, storeFreeFromCents: STORE_B.storeFree } : null, c.zone ? b.zones[c.zone] : undefined);
  });
});
