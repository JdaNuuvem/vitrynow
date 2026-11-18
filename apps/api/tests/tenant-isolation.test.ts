import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("isolamento multi-tenant", () => {
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

  it("loja B não vê nem edita entregadores/cupons/configurações da loja A", async () => {
    const { cookie: cookieA } = await registerStore(app, { slug: "loja-a", code: "A1" });
    const { cookie: cookieB } = await registerStore(app, { slug: "loja-b", code: "B1" });

    const deliverer = await app.inject({
      method: "POST",
      url: "/api/deliverers",
      headers: { cookie: cookieA! },
      payload: { name: "Motoboy A" },
    });
    const delivererId = JSON.parse(deliverer.body).deliverer.id;

    const editFromB = await app.inject({
      method: "POST",
      url: `/api/deliverers/${delivererId}`,
      headers: { cookie: cookieB! },
      payload: { active: false },
    });
    expect(editFromB.statusCode).toBe(404);

    const listFromB = await app.inject({ method: "GET", url: "/api/deliverers", headers: { cookie: cookieB! } });
    expect(JSON.parse(listFromB.body).deliverers).toHaveLength(0);

    await app.inject({
      method: "POST",
      url: "/api/coupons",
      headers: { cookie: cookieA! },
      payload: { code: "SOA", discountType: "PERCENT", discountValue: 10 },
    });
    const couponsFromB = await app.inject({ method: "GET", url: "/api/coupons", headers: { cookie: cookieB! } });
    expect(JSON.parse(couponsFromB.body).coupons).toHaveLength(0);

    const settingsFromB = await app.inject({ method: "GET", url: "/api/store/settings", headers: { cookie: cookieB! } });
    expect(JSON.parse(settingsFromB.body).store.slug).toBe("loja-b");
  });

  it("pedido criado na loja A não aparece na lista de pedidos nem no device-token da loja B", async () => {
    const { cookie: cookieA } = await registerStore(app, { slug: "loja-c", code: "C1" });
    const { cookie: cookieB } = await registerStore(app, { slug: "loja-d", code: "D1" });

    const category = await app.inject({
      method: "POST",
      url: "/api/catalog/categories",
      headers: { cookie: cookieA! },
      payload: { name: "Lanches" },
    });
    const categoryId = JSON.parse(category.body).category.id;
    const product = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie: cookieA! },
      payload: { categoryId, name: "X-Tudo", priceCents: 2000 },
    });
    const productId = JSON.parse(product.body).product.id;

    const order = await app.inject({
      method: "POST",
      url: "/stores/loja-c/orders",
      payload: { type: "BALCAO", items: [{ productId, quantity: 1 }] },
    });
    expect(order.statusCode).toBe(201);

    const ordersA = await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: cookieA! } });
    const ordersB = await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: cookieB! } });
    expect(JSON.parse(ordersA.body).orders).toHaveLength(1);
    expect(JSON.parse(ordersB.body).orders).toHaveLength(0);

    const deviceTokenB = await app.inject({
      method: "POST",
      url: "/api/device-tokens",
      headers: { cookie: cookieB! },
      payload: { label: "loja b" },
    });
    const tokenB = JSON.parse(deviceTokenB.body).token.token;
    const pendingForB = await app.inject({
      method: "GET",
      url: "/api/device/orders/pending",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(JSON.parse(pendingForB.body).orders).toHaveLength(0);
  });
});
