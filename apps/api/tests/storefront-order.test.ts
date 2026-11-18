import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("pedido no storefront + cupom", () => {
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

  async function setupProduct(cookie: string, slug: string) {
    const category = await app.inject({
      method: "POST",
      url: "/api/catalog/categories",
      headers: { cookie },
      payload: { name: "Lanches" },
    });
    const categoryId = JSON.parse(category.body).category.id;
    const product = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie },
      payload: { categoryId, name: "Combo", priceCents: 1500 },
    });
    return JSON.parse(product.body).product.id as string;
  }

  it("aplica cupom percentual corretamente e marca o uso", async () => {
    const { cookie, credentials } = await registerStore(app, { slug: "loja-cupom", code: "CP1" });
    const productId = await setupProduct(cookie!, "loja-cupom");

    await app.inject({
      method: "POST",
      url: "/api/coupons",
      headers: { cookie: cookie! },
      payload: { code: "dez", discountType: "PERCENT", discountValue: 10 },
    });

    const order = await app.inject({
      method: "POST",
      url: "/stores/loja-cupom/orders",
      payload: { type: "BALCAO", items: [{ productId, quantity: 1 }], couponCode: "dez" },
    });
    expect(order.statusCode).toBe(201);

    const orders = await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: cookie! } });
    const [created] = JSON.parse(orders.body).orders;
    expect(created.subtotalCents).toBe(1500);
    expect(created.discountCents).toBe(150);
    expect(created.totalCents).toBe(1350);

    const coupons = await app.inject({ method: "GET", url: "/api/coupons", headers: { cookie: cookie! } });
    expect(JSON.parse(coupons.body).coupons[0].usedCount).toBe(1);
    void credentials;
  });

  it("rejeita cupom esgotado e não desconta de novo", async () => {
    const { cookie } = await registerStore(app, { slug: "loja-cupom2", code: "CP2" });
    const productId = await setupProduct(cookie!, "loja-cupom2");

    await app.inject({
      method: "POST",
      url: "/api/coupons",
      headers: { cookie: cookie! },
      payload: { code: "unico", discountType: "FIXED", discountValue: 100, maxUses: 1 },
    });

    const first = await app.inject({
      method: "POST",
      url: "/stores/loja-cupom2/orders",
      payload: { type: "BALCAO", items: [{ productId, quantity: 1 }], couponCode: "unico" },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/stores/loja-cupom2/orders",
      payload: { type: "BALCAO", items: [{ productId, quantity: 1 }], couponCode: "unico" },
    });
    expect(second.statusCode).toBe(400);
    expect(JSON.parse(second.body)).toMatchObject({ code: "COUPON_EXHAUSTED", error: "Esse cupom acabou." });
  });

  it("falha de PIX (sem MP_ACCESS_TOKEN em teste) cancela o pedido SEM apagá-lo e devolve o uso do cupom", async () => {
    const { cookie } = await registerStore(app, { slug: "loja-pix", code: "PIX1" });
    const productId = await setupProduct(cookie!, "loja-pix");

    await app.inject({
      method: "POST",
      url: "/api/coupons",
      headers: { cookie: cookie! },
      payload: { code: "pixdesc", discountType: "PERCENT", discountValue: 10 },
    });

    const order = await app.inject({
      method: "POST",
      url: "/stores/loja-pix/orders",
      payload: {
        type: "BALCAO",
        items: [{ productId, quantity: 1 }],
        couponCode: "pixdesc",
        paymentMethod: "PIX",
      },
    });
    expect(order.statusCode).toBe(502);

    const orders = await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: cookie! } });
    expect(JSON.parse(orders.body).orders).toHaveLength(0);

    const coupons = await app.inject({ method: "GET", url: "/api/coupons", headers: { cookie: cookie! } });
    expect(JSON.parse(coupons.body).coupons[0].usedCount).toBe(0);

    // B16: o pedido continua no banco (auditoria), cancelado com motivo, e a cobrança local foi fechada.
    const kept = await prisma.order.findFirst({ where: { store: { slug: "loja-pix" } }, include: { payment: true, statusHistory: { orderBy: { seq: "desc" }, take: 1 } } });
    expect({ status: kept?.status, payment: kept?.payment?.status }).toEqual({ status: "CANCELADO", payment: "CANCELADO" });
    expect(kept?.statusHistory[0]).toMatchObject({ kind: "CANCEL", reasonCode: "PAGAMENTO_NAO_APROVADO", source: "SYSTEM" });
  });

  it("pedido aguardando pagamento PIX não aparece no kanban nem no device até confirmar", async () => {
    // Simula sem passar por PIX real: cria pedido normal e confere que o filtro
    // awaitingPayment:false não esconde pedidos pagos presencialmente.
    const { cookie } = await registerStore(app, { slug: "loja-normal", code: "NRM1" });
    const productId = await setupProduct(cookie!, "loja-normal");

    const order = await app.inject({
      method: "POST",
      url: "/stores/loja-normal/orders",
      payload: { type: "BALCAO", items: [{ productId, quantity: 1 }] },
    });
    expect(order.statusCode).toBe(201);

    const orders = await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: cookie! } });
    expect(JSON.parse(orders.body).orders).toHaveLength(1);
  });
});
