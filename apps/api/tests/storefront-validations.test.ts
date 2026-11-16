// API-05 — validações do pedido público feitas no servidor (B08 produto ativo; B09 entrega/retirada, endereço, telefone).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-05 — pedido público: validações no servidor", () => {
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

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const mk = async (name: string) =>
      json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name, priceCents: 1000 } })).product.id as string;
    return { storeId: storeId as string, slug: slug as string, productId: await mk("Combo"), otherProductId: await mk("Suco") };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const place = (ctx: Ctx, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { items: [{ productId: ctx.productId, quantity: 1 }], ...payload } });
  const delivery = { type: "DELIVERY", address: "Rua A, 1", customerPhone: "11999999999", customerName: "Ana" };
  const countOrders = (ctx: Ctx) => prisma.order.count({ where: { storeId: ctx.storeId } });

  // ───────────── B08: produto pausado ─────────────
  it("produto pausado não pode ser pedido (400 PRODUCT_UNAVAILABLE) e o pedido inteiro é recusado", async () => {
    const ctx = await setup();
    await prisma.product.update({ where: { id: ctx.productId }, data: { active: false } });

    const only = await place(ctx, { type: "BALCAO" });
    expect(only.statusCode).toBe(400);
    expect(json(only)).toMatchObject({ code: "PRODUCT_UNAVAILABLE", productIds: [ctx.productId] });
    expect(json(only).error).toContain("Combo");

    // Um pausado + um ativo: nada é criado (não aceita "o que dá").
    const mixed = await place(ctx, {
      type: "BALCAO",
      items: [
        { productId: ctx.productId, quantity: 1 },
        { productId: ctx.otherProductId, quantity: 1 },
      ],
    });
    expect(mixed.statusCode).toBe(400);
    expect(json(mixed).productIds).toEqual([ctx.productId]);
    expect(await countOrders(ctx)).toBe(0);
  });

  it("produto reativado volta a poder ser pedido", async () => {
    const ctx = await setup();
    await prisma.product.update({ where: { id: ctx.productId }, data: { active: false } });
    expect((await place(ctx, { type: "BALCAO" })).statusCode).toBe(400);
    await prisma.product.update({ where: { id: ctx.productId }, data: { active: true } });
    expect((await place(ctx, { type: "BALCAO" })).statusCode).toBe(201);
  });

  // ───────────── B09: entrega ─────────────
  it("DELIVERY com entrega desabilitada na loja ⇒ 409 DELIVERY_DISABLED; retirada continua funcionando", async () => {
    const ctx = await setup();
    await prisma.store.update({ where: { id: ctx.storeId }, data: { deliveryEnabled: false } });
    const res = await place(ctx, delivery);
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe("DELIVERY_DISABLED");
    expect((await place(ctx, { type: "BALCAO" })).statusCode).toBe(201);
    expect(await countOrders(ctx)).toBe(1);
  });

  it("DELIVERY exige endereço (400 ADDRESS_REQUIRED, inclusive só espaços) e telefone (400 PHONE_REQUIRED)", async () => {
    const ctx = await setup();
    const noAddress = await place(ctx, { ...delivery, address: undefined });
    expect([noAddress.statusCode, json(noAddress).code]).toEqual([400, "ADDRESS_REQUIRED"]);
    const blank = await place(ctx, { ...delivery, address: "    " });
    expect([blank.statusCode, json(blank).code]).toEqual([400, "ADDRESS_REQUIRED"]);
    const noPhone = await place(ctx, { ...delivery, customerPhone: undefined });
    expect([noPhone.statusCode, json(noPhone).code]).toEqual([400, "PHONE_REQUIRED"]);
    expect(await countOrders(ctx)).toBe(0);

    const ok = await place(ctx, delivery);
    expect(ok.statusCode).toBe(201);
    expect(await countOrders(ctx)).toBe(1);
  });

  // ───────────── B09: retirada ─────────────
  it("BALCAO com retirada desabilitada ⇒ 409 PICKUP_DISABLED; entrega continua funcionando", async () => {
    const ctx = await setup();
    await prisma.store.update({ where: { id: ctx.storeId }, data: { pickupEnabled: false } });
    const res = await place(ctx, { type: "BALCAO" });
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe("PICKUP_DISABLED");
    expect((await place(ctx, delivery)).statusCode).toBe(201);
  });

  it("recusas de modalidade não consomem número de pedido (próximo pedido válido é 0001)", async () => {
    const ctx = await setup();
    await prisma.store.update({ where: { id: ctx.storeId }, data: { deliveryEnabled: false } });
    await place(ctx, delivery);
    await place(ctx, delivery);
    const ok = await place(ctx, { type: "BALCAO" });
    expect(json(ok).code).toBe("0001");
  });

  it("loja fechada continua tendo prioridade (409 STORE_CLOSED) sobre as demais regras", async () => {
    const ctx = await setup();
    await prisma.store.update({ where: { id: ctx.storeId }, data: { acceptingOrders: false, deliveryEnabled: false } });
    const res = await place(ctx, delivery);
    expect([res.statusCode, json(res).code]).toEqual([409, "STORE_CLOSED"]);
  });
});
