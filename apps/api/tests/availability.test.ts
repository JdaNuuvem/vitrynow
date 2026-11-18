import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("loja disponível/fechada", () => {
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

  it("com a loja indisponível o cardápio público recusa pedidos e volta a aceitar ao reabrir", async () => {
    const { cookie } = await registerStore(app, { slug: "loja-disp", code: "DS1" });
    const category = await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "Lanches" } });
    const product = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie: cookie! },
      payload: { categoryId: JSON.parse(category.body).category.id, name: "Combo", priceCents: 1500 },
    });
    const productId = JSON.parse(product.body).product.id;
    const order = () =>
      app.inject({ method: "POST", url: "/stores/loja-disp/orders", payload: { type: "BALCAO", items: [{ productId, quantity: 1 }] } });

    const settings = JSON.parse((await app.inject({ method: "GET", url: "/api/store/settings", headers: { cookie: cookie! } })).body);
    expect(settings.store.acceptingOrders).toBe(true);

    const close = await app.inject({ method: "POST", url: "/api/store/availability", headers: { cookie: cookie! }, payload: { acceptingOrders: false } });
    expect(close.statusCode).toBe(200);

    const menu = JSON.parse((await app.inject({ method: "GET", url: "/stores/loja-disp/menu" })).body);
    expect(menu.store.acceptingOrders).toBe(false);

    const refused = await order();
    expect(refused.statusCode).toBe(409);
    expect(JSON.parse(refused.body).code).toBe("STORE_CLOSED");

    await app.inject({ method: "POST", url: "/api/store/availability", headers: { cookie: cookie! }, payload: { acceptingOrders: true } });
    expect((await order()).statusCode).toBe(201);
  });

  it("exige autenticação e valida o corpo", async () => {
    const anonymous = await app.inject({ method: "POST", url: "/api/store/availability", payload: { acceptingOrders: false } });
    expect(anonymous.statusCode).toBe(401);

    const { cookie } = await registerStore(app, { slug: "loja-disp2", code: "DS2" });
    const invalid = await app.inject({ method: "POST", url: "/api/store/availability", headers: { cookie: cookie! }, payload: { acceptingOrders: "talvez" } });
    expect(invalid.statusCode).toBe(400);
  });
});
