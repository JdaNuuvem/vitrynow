import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { resetLimits } from "../src/lib/slidingLimit";
import { MAX_PENDING_PER_PHONE, PUBLIC_ORDERS_PER_STORE_PER_MINUTE } from "../src/routes/storefront";
import { makeApp, registerStore, resetDb } from "./helpers";

// NG-08 (B19): anti-abuso do pedido público. Com a impressão ao chegar, o limite por IP não basta: tetos por LOJA e por TELEFONE (pedidos ainda pendentes).

describe("NG-08: pedido público — teto por telefone e por loja", () => {
  let app: ReturnType<typeof makeApp>;
  let ipSeq = 0;
  const nextIp = () => `10.88.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`; // um IP novo por pedido: o limite por IP (20/min) não interfere
  beforeEach(async () => {
    await resetDb();
    resetLimits();
    app = makeApp();
    await app.ready();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "Pizza", priceCents: 3000 } })).product.id as string;
    return { owner: cookie!, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  const pedir = (l: Loja, phone: string, productId = l.productId) =>
    app.inject({
      method: "POST",
      url: `/stores/${l.store.slug}/orders`,
      remoteAddress: nextIp(),
      payload: { type: "DELIVERY", items: [{ productId, quantity: 1 }], paymentMethod: "DINHEIRO", customerName: "Cliente", customerPhone: phone, address: "Rua A 1" },
    });

  it(`telefone: o ${MAX_PENDING_PER_PHONE + 1}º pedido PENDENTE do mesmo telefone leva 429; outro telefone passa; pedido já aceito deixa de contar`, async () => {
    const l = await loja();
    for (let i = 0; i < MAX_PENDING_PER_PHONE; i += 1) expect((await pedir(l, "11987654321")).statusCode, `pedido ${i + 1}`).toBe(201);
    const blocked = await pedir(l, "11987654321");
    expect(blocked.statusCode).toBe(429);
    expect(json(blocked).code).toBe("RATE_LIMITED"); // o MESMO 429 do sistema: não diz qual teto
    expect(await prisma.order.count({ where: { storeId: l.store.id } })).toBe(MAX_PENDING_PER_PHONE); // a recusa não gravou nada

    expect((await pedir(l, "11911112222")).statusCode, "outro telefone").toBe(201);

    // a loja aceita um dos pendentes: o telefone volta a ter vaga
    const first = await prisma.order.findFirstOrThrow({ where: { storeId: l.store.id, customerPhone: "11987654321" }, orderBy: { createdAt: "asc" } });
    await prisma.order.update({ where: { id: first.id }, data: { status: "CONFIRMADO" } });
    expect((await pedir(l, "11987654321")).statusCode, "depois do aceite").toBe(201);
  });

  it("telefone: o teto é POR LOJA (o mesmo telefone em outra loja não é afetado)", async () => {
    const a = await loja();
    const b = await loja();
    for (let i = 0; i < MAX_PENDING_PER_PHONE; i += 1) await pedir(a, "11987654321");
    expect((await pedir(a, "11987654321")).statusCode).toBe(429);
    expect((await pedir(b, "11987654321")).statusCode).toBe(201);
  });

  it(`loja: o ${PUBLIC_ORDERS_PER_STORE_PER_MINUTE + 1}º pedido no minuto, de IPs e telefones diferentes, leva 429; outra loja não é afetada`, async () => {
    const a = await loja();
    const b = await loja();
    // produto inexistente: o pedido é recusado (400) DEPOIS de consumir o teto, então o teste não grava 60 pedidos
    const ghost = "cabcdefghijklmnopqrstuvwx";
    for (let i = 0; i < PUBLIC_ORDERS_PER_STORE_PER_MINUTE; i += 1) {
      const res = await pedir(a, `119${String(10_000_000 + i)}`, ghost);
      expect(res.statusCode, `tentativa ${i + 1}`).toBe(400);
    }
    expect((await pedir(a, "11999990000", ghost)).statusCode).toBe(429);
    expect((await pedir(b, "11999990000")).statusCode, "outra loja").toBe(201);
  });
});
