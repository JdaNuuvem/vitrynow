// B01 — código de pedido sem corrida. Regressão das sondas D02/D02b (Deming).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("B01 — código de pedido concorrente", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = JSON.parse(response.body).store;
    const cat = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).body).category.id;
    const productId = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).body).product.id;
    return { storeId: storeId as string, slug: slug as string, productId: productId as string };
  }
  const place = (s: { slug: string; productId: string }) =>
    app.inject({ method: "POST", url: `/stores/${s.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: s.productId, quantity: 1 }] } });

  it("20 pedidos paralelos na mesma loja: todos 201, códigos únicos e contíguos 0001..0020", async () => {
    const s = await setup();
    const results = await Promise.all(Array.from({ length: 20 }, () => place(s)));
    expect(results.map((r) => r.statusCode)).toEqual(Array(20).fill(201));
    const codes = results.map((r) => JSON.parse(r.body).code as string).sort();
    expect(codes).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(4, "0")));
    const stored = await prisma.order.count({ where: { storeId: s.storeId } });
    expect(stored).toBe(20);
  });

  it("a numeração é independente por loja", async () => {
    const a = await setup();
    const b = await setup();
    const [ra, rb] = await Promise.all([place(a), place(b)]);
    expect(JSON.parse(ra.body).code).toBe("0001");
    expect(JSON.parse(rb.body).code).toBe("0001");
    const rb2 = await place(b);
    expect(JSON.parse(rb2.body).code).toBe("0002");
  });

  it("continua a numeração de uma loja que já tinha pedidos antes do contador (backfill)", async () => {
    const s = await setup();
    await place(s);
    await place(s);
    // simula loja legada: pedidos existem, contador não
    await prisma.storeCounter.deleteMany({ where: { storeId: s.storeId } });
    await prisma.storeCounter.create({ data: { storeId: s.storeId, orderSeq: 2 } });
    const r = await place(s);
    expect(JSON.parse(r.body).code).toBe("0003");
  });
});
