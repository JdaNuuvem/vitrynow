// API-48b: tabelas filhas com `storeId` próprio e FK composta (paiId, storeId). O BANCO recusa filho apontando para pai de outra loja,
// e todo filho criado pelos fluxos normais nasce com o storeId do pai.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-48b — isolamento das tabelas filhas no banco", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function lojaComPedido() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const product = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000, additionals: [{ name: "Extra", priceCents: 100 }] } })).product;
    const r = await app.inject({ method: "POST", url: `/stores/${store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: product.id, quantity: 1, additionalIds: [product.additionals[0].id] }] } });
    expect(r.statusCode, r.body).toBe(201);
    return { store, cookie: cookie!, productId: product.id as string, orderId: json(r).orderId as string };
  }

  it("fluxo normal: item, adicional do item, histórico e adicional do produto nascem com o storeId do pai", async () => {
    const a = await lojaComPedido();
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: a.orderId }, include: { additionals: true } });
    expect(item.storeId).toBe(a.store.id);
    expect(item.additionals.every((x) => x.storeId === a.store.id)).toBe(true);
    expect((await prisma.orderStatusHistory.findMany({ where: { orderId: a.orderId } })).every((h) => h.storeId === a.store.id)).toBe(true);
    expect((await prisma.productAdditional.findMany({ where: { productId: a.productId } })).every((x) => x.storeId === a.store.id)).toBe(true);
  });

  it("o banco recusa filho com storeId de OUTRA loja (item, histórico, pagamento, adicional, movimento de caixa)", async () => {
    const a = await lojaComPedido();
    const b = await lojaComPedido();
    const outra = b.store.id;
    await expect(prisma.orderItem.create({ data: { orderId: a.orderId, storeId: outra, productName: "x", quantity: 1, unitPriceCents: 1 } })).rejects.toThrow();
    await expect(prisma.orderStatusHistory.create({ data: { orderId: a.orderId, storeId: outra, status: "CONFIRMADO" } })).rejects.toThrow();
    await expect(prisma.payment.create({ data: { orderId: a.orderId, storeId: outra, amountCents: 1 } })).rejects.toThrow();
    await expect(prisma.productAdditional.create({ data: { productId: a.productId, storeId: outra, name: "x", priceCents: 1 } })).rejects.toThrow();
    const itemA = await prisma.orderItem.findFirstOrThrow({ where: { orderId: a.orderId } });
    await expect(prisma.orderItemAdditional.create({ data: { orderItemId: itemA.id, storeId: outra, name: "x", priceCents: 1 } })).rejects.toThrow();
    await expect(prisma.orderItemOption.create({ data: { orderItemId: itemA.id, storeId: outra, groupName: "g", name: "x", priceCents: 1 } })).rejects.toThrow();
    const user = await prisma.user.findFirstOrThrow({ where: { storeId: a.store.id } });
    const session = await prisma.cashSession.create({ data: { storeId: a.store.id, openedByUserId: user.id } });
    await expect(prisma.cashMovement.create({ data: { cashSessionId: session.id, storeId: outra, type: "SUPRIMENTO", amountCents: 1 } })).rejects.toThrow();
    // o mesmo filho com o storeId certo entra
    await expect(prisma.orderStatusHistory.create({ data: { orderId: a.orderId, storeId: a.store.id, status: "CONFIRMADO" } })).resolves.toBeTruthy();
  });
});
