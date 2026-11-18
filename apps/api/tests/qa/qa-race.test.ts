// Sonda de corrida do cupom (D01b) e causa do 500 (D02b). Cria pedidos com atraso escalonado
// para que o conflito de código de pedido não mascare a corrida do cupom.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

// Convenções (QA/Deming):
//  - bug(...)      = bug CONFIRMADO e determinístico. Usa it.fails: a suíte fica verde enquanto o bug existe e
//                    fica VERMELHA quando alguém o corrigir. Nesse momento troque 'bug' por 'it' (vira regressão).
//  - flakyBug(...) = bug CONFIRMADO mas intermitente (corrida). Fica skip no CI; rode 3x à mão ao corrigir e depois vire 'it'.
const bug = it.fails;
const flakyBug = it.skip;

describe("QA probes — corridas", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = JSON.parse(response.body).store;
    const cat = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).body).category.id;
    const productId = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).body).product.id;
    return { cookie: cookie!, storeId: storeId as string, slug: slug as string, productId: productId as string };
  }
  const place = (s: { slug: string; productId: string }, extra = {}) =>
    app.inject({ method: "POST", url: `/stores/${s.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: s.productId, quantity: 1 }], ...extra } });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("D02b dois pedidos quase simultâneos: o segundo cliente leva 500 por código de pedido duplicado", async () => {
    const s = await setup();
    const [a, b] = await Promise.all([place(s), place(s)]);
    const codes = [a, b].map((r) => `${r.statusCode}`);
    expect(codes, "esperado 201,201").toEqual(["201", "201"]);
  });

  flakyBug("D01b cupom maxUses=1 com chegadas escalonadas nunca passa do limite", async () => {
    const s = await setup();
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: s.cookie }, payload: { code: "unico", discountType: "FIXED", discountValue: 100, maxUses: 1 } });
    const offsets = [0, 4, 8, 12, 16, 20, 25, 30, 40, 50];
    const results = await Promise.all(offsets.map(async (ms) => { await sleep(ms); return place(s, { couponCode: "unico" }); }));
    const ok = results.filter((r) => r.statusCode === 201).length;
    const coupon = await prisma.coupon.findFirst({ where: { storeId: s.storeId } });
    const statuses = results.map((r) => r.statusCode).join(",");
    expect({ ok, usedCount: coupon?.usedCount, statuses }).toMatchObject({ ok: 1, usedCount: 1 });
  });
});
