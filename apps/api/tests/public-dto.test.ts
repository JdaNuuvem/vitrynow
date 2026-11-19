// SEC-18: DTO publico. As rotas SEM login so respondem com campos de uma lista de permissao por rota. Os testes travam o conjunto EXATO de chaves:
// um campo novo no banco (ou um `include` cru) que apareca na resposta quebra aqui, em vez de vazar em producao.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { PUBLIC_ADDITIONAL_KEYS, PUBLIC_CATEGORY_KEYS, PUBLIC_OPTION_GROUP_KEYS, PUBLIC_STORE_HOURS_KEYS, PUBLIC_OPTION_KEYS, PUBLIC_PRODUCT_KEYS, PUBLIC_STORE_KEYS } from "../src/lib/publicDto";
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
    expect(keys(body.store)).toEqual(sorted([...PUBLIC_STORE_KEYS, "payment", "accepting", "hours", "campaign", ...PUBLIC_STORE_HOURS_KEYS])); // `payment.pixAvailable` vem do plugin do PIX; `accepting` (loja recebe pedido AGORA) vem do portao de assinatura (API-09)
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
    expect(keys(json(created))).toEqual(["code", "discountCents", "orderId", "token", "totalCents"]);
    expect(json(created)).toMatchObject({ discountCents: 0, totalCents: 3000 });
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

  it("API-15 parte 3: grupo real sai so pela lista (sem source/active/position), opcao inativa some, espelho LEGACY nao duplica, obrigatorio sem opcao => unavailable", async () => {
    const l = await loja();
    const storeId = l.store.id;
    await prisma.optionGroup.create({
      data: { id: "og_pub1", storeId, name: "Tamanho", minSelect: 1, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", source: "MANUAL", options: { create: [{ id: "op_pub_g", name: "Grande", priceCents: 500, position: 0 }, { id: "op_pub_x", name: "Oculta", priceCents: 900, position: 1, active: false }] } },
    });
    await prisma.productOptionGroup.create({ data: { storeId, productId: l.productId, groupId: "og_pub1", position: 0 } });
    await prisma.optionGroup.create({
      data: { id: "og_pub_leg", storeId, name: "Adicionais", minSelect: 0, maxSelect: null, maxPerOption: 1, priceMode: "SUM", source: "LEGACY_ADDITIONALS", options: { create: [{ id: "op_pub_leg", name: "Borda", priceCents: 500, position: 0 }] } },
    });
    await prisma.productOptionGroup.create({ data: { storeId, productId: l.productId, groupId: "og_pub_leg", position: 1 } });
    const body = json(await app.inject({ method: "GET", url: `/stores/${l.store.slug}/menu` }));
    const product = body.categories[0].products[0];
    expect(product.optionGroups).toHaveLength(1);
    expect(keys(product.optionGroups[0])).toEqual(sorted(PUBLIC_OPTION_GROUP_KEYS));
    expect(product.optionGroups[0].options).toEqual([{ id: "op_pub_g", name: "Grande", priceCents: 500 }]);
    expect(keys(product.optionGroups[0].options[0])).toEqual(sorted(PUBLIC_OPTION_KEYS));
    expect(product.unavailable).toBe(false);
    expect(JSON.stringify(product)).not.toContain("Oculta");
    // a unica opcao do grupo obrigatorio some => produto indisponivel por regra
    await prisma.option.update({ where: { id: "op_pub_g" }, data: { active: false } });
    const again = json(await app.inject({ method: "GET", url: `/stores/${l.store.slug}/menu` })).categories[0].products[0];
    expect(again.unavailable).toBe(true);
  });
});
