import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb, orderTokenHeader } from "./helpers";

describe("hardening", () => {
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

  it("GET /health confere o banco", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe("ok");
  });

  it("não deixa abrir dois caixas ao mesmo tempo na mesma loja (concorrência real)", async () => {
    const { cookie } = await registerStore(app, { slug: "loja-caixa", code: "CX1" });

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/cashier/open",
        headers: { cookie: cookie! },
        payload: { openingBalanceCents: 1000 },
      }),
      app.inject({
        method: "POST",
        url: "/api/cashier/open",
        headers: { cookie: cookie! },
        payload: { openingBalanceCents: 2000 },
      }),
    ]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const current = await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: cookie! } });
    expect(JSON.parse(current.body).session).not.toBeNull();
  });

  it("cliente cancela pedido PENDENTE, mas não depois que a loja confirma", async () => {
    const { cookie } = await registerStore(app, { slug: "loja-cancela", code: "CAN1" });
    const category = await app.inject({
      method: "POST",
      url: "/api/catalog/categories",
      headers: { cookie: cookie! },
      payload: { name: "Lanches" },
    });
    const categoryId = JSON.parse(category.body).category.id;
    const product = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie: cookie! },
      payload: { categoryId, name: "Combo", priceCents: 1000 },
    });
    const productId = JSON.parse(product.body).product.id;

    const order = await app.inject({
      method: "POST",
      url: "/stores/loja-cancela/orders",
      payload: { type: "BALCAO", items: [{ productId, quantity: 1 }] },
    });
    const orderId = JSON.parse(order.body).orderId;

    const confirm = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/status`,
      headers: { cookie: cookie! },
      payload: { status: "CONFIRMADO" },
    });
    expect(confirm.statusCode).toBe(200);

    const cancelAfterConfirm = await app.inject({
      method: "POST",
      url: `/stores/loja-cancela/orders/${orderId}/cancel`, headers: orderTokenHeader(orderId),
    });
    expect(cancelAfterConfirm.statusCode).toBe(409);

    const order2 = await app.inject({
      method: "POST",
      url: "/stores/loja-cancela/orders",
      payload: { type: "BALCAO", items: [{ productId, quantity: 1 }] },
    });
    const order2Id = JSON.parse(order2.body).orderId;
    const cancelPending = await app.inject({
      method: "POST",
      url: `/stores/loja-cancela/orders/${order2Id}/cancel`, headers: orderTokenHeader(order2Id),
    });
    expect(cancelPending.statusCode).toBe(200);
  });

  it("excluir um produto não quebra pedidos antigos (nome fica salvo no pedido)", async () => {
    const { cookie } = await registerStore(app, { slug: "loja-snapshot", code: "SNP1" });
    const category = await app.inject({
      method: "POST",
      url: "/api/catalog/categories",
      headers: { cookie: cookie! },
      payload: { name: "Lanches" },
    });
    const categoryId = JSON.parse(category.body).category.id;
    const product = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie: cookie! },
      payload: { categoryId, name: "Produto Temporário", priceCents: 1200 },
    });
    const productId = JSON.parse(product.body).product.id;

    const placed = await app.inject({
      method: "POST",
      url: "/stores/loja-snapshot/orders",
      payload: { type: "BALCAO", items: [{ productId, quantity: 2 }] },
    });
    // API-56: produto em pedido EM ABERTO não é excluído (409, RN-CT-12); o pedido antigo é o já encerrado.
    const blocked = await app.inject({ method: "POST", url: `/api/catalog/products/${productId}/delete`, headers: { cookie: cookie! } });
    expect(blocked.statusCode).toBe(409);
    await prisma.order.update({ where: { id: JSON.parse(placed.body).orderId }, data: { status: "CONCLUIDO" } });

    const deleteProduct = await app.inject({
      method: "POST",
      url: `/api/catalog/products/${productId}/delete`,
      headers: { cookie: cookie! },
    });
    expect(deleteProduct.statusCode).toBe(200);

    const orders = await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: cookie! } });
    const [order] = JSON.parse(orders.body).orders;
    expect(order.items[0].productName).toBe("Produto Temporário");
    // O id do produto não faz parte da resposta do painel (allowlist, API-54a); o vínculo some no banco, o snapshot fica.
    expect(order.items[0]).not.toHaveProperty("productId");
    const stored = await prisma.orderItem.findFirstOrThrow({ where: { order: { id: order.id } } });
    expect(stored.productId).toBeNull();
  });
});
