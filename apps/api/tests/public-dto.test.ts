// SEC-18: DTO publico. As rotas SEM login so respondem com campos de uma lista de permissao por rota. Os testes travam o conjunto EXATO de chaves:
// um campo novo no banco (ou um `include` cru) que apareca na resposta quebra aqui, em vez de vazar em producao.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { PUBLIC_ADDITIONAL_KEYS, PUBLIC_CATEGORY_KEYS, PUBLIC_PRODUCT_KEYS, PUBLIC_STORE_KEYS } from "../src/lib/publicDto";
import { makeApp, orderTokenHeader, registerStore, resetDb } from "./helpers";

describe("SEC-18 - respostas das rotas publicas so com campos permitidos", { timeout: 60_000 }, () => {
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
  const keys = (o: object) => Object.keys(o).sort();
  const sorted = (a: readonly string[]) => [...a].sort();

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string; code: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C", icon: "x" } })).category.id;
    const productId = json(
      await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "Pizza", priceCents: 3000, additionals: [{ name: "Borda", priceCents: 500 }] } }),
    ).product.id as string;
    return { owner: cookie!, store, productId };
  }

  it("menu: loja, categoria, produto e adicional tem EXATAMENTE as chaves permitidas (sem storeId, createdAt, active, position, id da loja...)", async () => {
    const l = await loja();
    const res = await app.inject({ method: "GET", url: `/stores/${l.store.slug}/menu` });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(keys(body)).toEqual(["categories", "store"]);
    expect(keys(body.store)).toEqual(sorted([...PUBLIC_STORE_KEYS, "payment"])); // `payment.pixAvailable` vem do plugin de disponibilidade do PIX
    expect(keys(body.categories[0])).toEqual(sorted(PUBLIC_CATEGORY_KEYS));
    expect(keys(body.categories[0].products[0])).toEqual(sorted(PUBLIC_PRODUCT_KEYS));
    expect(keys(body.categories[0].products[0].additionals[0])).toEqual(sorted(PUBLIC_ADDITIONAL_KEYS));
    const text = res.body;
    for (const forbidden of ['"storeId"', '"createdAt"', '"updatedAt"', '"active"', '"position"', '"categoryId"', '"productId"', '"timezone"', '"customDomain"', '"printMode"', '"cashStaffWithdrawalLimitCents"']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(text).not.toContain(l.store.id); // o id interno da loja nunca aparece
    expect(text).not.toContain(l.store.code);
  });

  it("menu: produto inativo continua fora e o preco/nome continuam corretos (a lista nao muda o conteudo permitido)", async () => {
    const l = await loja();
    const body = json(await app.inject({ method: "GET", url: `/stores/${l.store.slug}/menu` }));
    expect(body.categories[0].products[0]).toMatchObject({ id: l.productId, name: "Pizza", priceCents: 3000, additionals: [{ name: "Borda", priceCents: 500 }] });
    await app.inject({ method: "POST", url: `/api/catalog/products/${l.productId}`, headers: { cookie: l.owner }, payload: { active: false } });
    expect(json(await app.inject({ method: "GET", url: `/stores/${l.store.slug}/menu` })).categories[0].products).toHaveLength(0);
  });

  it("acompanhamento, status do pagamento e cancelamento: chaves exatas e nenhum dado pessoal", async () => {
    const l = await loja();
    const created = await app.inject({
      method: "POST",
      url: `/stores/${l.store.slug}/orders`,
      payload: { type: "DELIVERY", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "DINHEIRO", customerName: "Maria Segredo", customerPhone: "11987654321", address: "Rua Reservada 123", notes: "obs secreta" },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(keys(json(created))).toEqual(["code", "orderId", "token"]);
    const orderId = json(created).orderId as string;
    const headers = orderTokenHeader(orderId);

    const tracking = await app.inject({ method: "GET", url: `/stores/${l.store.slug}/orders/${orderId}/tracking`, headers });
    expect(keys(json(tracking))).toEqual(["cancelReason", "order", "store", "timeline"]);
    expect(keys(json(tracking).order)).toEqual(["awaitingPayment", "code", "createdAt", "status", "type"]);
    expect(keys(json(tracking).store)).toEqual(["name"]);

    const status = await app.inject({ method: "GET", url: `/stores/${l.store.slug}/orders/${orderId}/payment-status`, headers });
    expect(keys(json(status))).toEqual(["awaitingPayment", "cancelReason", "orderStatus", "paymentStatus", "terminal"]);

    for (const r of [tracking, status]) {
      for (const secret of ["Maria Segredo", "11987654321", "Rua Reservada", "obs secreta", '"storeId"', '"publicTokenHash"', '"providerPaymentId"', '"idempotencyKey"']) {
        expect(r.body, secret).not.toContain(secret);
      }
    }

    const cancel = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders/${orderId}/cancel`, headers });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(keys(json(cancel))).toEqual(["refund", "status"]);
  });
});
