// SEC-16: relatorio com limite. Janela maxima, teto de pedidos, datas validas, sem dado pessoal, isolamento entre lojas e exigencia de login.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { REPORT_MAX_WINDOW_DAYS, reportLimits, REPORT_MAX_ORDERS } from "../src/routes/reports";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("SEC-16 - /api/reports/summary com limites", { timeout: 60_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    reportLimits.maxOrders = REPORT_MAX_ORDERS;
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const json = (r: { body: string }) => JSON.parse(r.body);
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "Pizza", priceCents: 3000 } })).product.id as string;
    return { cookie: cookie!, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const pedido = (l: Loja) =>
    app.inject({
      method: "POST",
      url: `/stores/${l.store.slug}/orders`,
      payload: { type: "DELIVERY", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "DINHEIRO", customerName: "Maria Segredo", customerPhone: "11987654321", address: "Rua Reservada 123" },
    });
  const resumo = (l: Loja, query: string) => app.inject({ method: "GET", url: `/api/reports/summary${query}`, headers: { cookie: l.cookie } });

  it("janela maior que o maximo e recusada com codigo e instrucao; a janela maxima ainda passa", async () => {
    const l = await loja();
    const demais = await resumo(l, `?from=${day(-(REPORT_MAX_WINDOW_DAYS + 30))}&to=${day(0)}`);
    expect(demais.statusCode).toBe(400);
    expect(json(demais)).toMatchObject({ code: "REPORT_WINDOW_TOO_LARGE", details: { maxDays: REPORT_MAX_WINDOW_DAYS } });
    expect((await resumo(l, `?from=${day(-REPORT_MAX_WINDOW_DAYS + 2)}&to=${day(0)}`)).statusCode).toBe(200);
  });

  it("datas invertidas, invalidas ou repetidas na URL sao 400", async () => {
    const l = await loja();
    expect(json(await resumo(l, `?from=${day(0)}&to=${day(-5)}`)).code).toBe("REPORT_RANGE_INVALID");
    expect((await resumo(l, "?from=ontem")).statusCode).toBe(400);
    expect((await resumo(l, `?from=${day(-3)}&from=${day(-2)}`)).statusCode).toBe(400);
  });

  it("teto de pedidos: acima dele a resposta e 422 REPORT_TOO_LARGE (nunca parcial); no teto passa", async () => {
    const l = await loja();
    for (let i = 0; i < 3; i += 1) expect((await pedido(l)).statusCode).toBe(201);
    reportLimits.maxOrders = 2;
    const grande = await resumo(l, "");
    expect(grande.statusCode).toBe(422);
    expect(json(grande)).toMatchObject({ code: "REPORT_TOO_LARGE", details: { maxOrders: 2 } });
    reportLimits.maxOrders = 3;
    expect((await resumo(l, "")).statusCode).toBe(200);
  });

  it("sem dado pessoal na resposta e sem ver pedidos de outra loja", async () => {
    const a = await loja();
    const b = await loja();
    await pedido(a);
    const ra = await resumo(a, "");
    expect(ra.statusCode).toBe(200);
    for (const secret of ["Maria Segredo", "11987654321", "Rua Reservada"]) expect(ra.body).not.toContain(secret);
    expect(json(ra).orderCount + json(ra).openCount).toBeGreaterThanOrEqual(0);
    const rb = json(await resumo(b, ""));
    expect(rb.customerCount).toBe(0);
    expect(JSON.stringify(rb)).not.toContain("Pizza");
  });

  it("exige login", async () => {
    expect((await app.inject({ method: "GET", url: "/api/reports/summary" })).statusCode).toBe(401);
  });
});

describe("SEC-16 / RN-R-06 - STAFF so ve contagens no resumo", { timeout: 60_000 }, () => {
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

  it("OWNER ve o dinheiro; STAFF recebe os mesmos totais de contagem SEM nenhum campo em reais (ausentes, nao zerados)", async () => {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "Pizza", priceCents: 3000 } })).product.id as string;
    const email = `s-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email, password: "provisoria-12" } });
    const staff = ((await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria-12" } })).headers["set-cookie"] as string).split(";")[0];
    const created = await app.inject({ method: "POST", url: `/stores/${store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 2 }], paymentMethod: "DINHEIRO" } });
    await app.inject({ method: "POST", url: `/api/orders/${json(created).orderId}/transition`, headers: { cookie: cookie! }, payload: { to: "CONFIRMADO" } });

    const dono = json(await app.inject({ method: "GET", url: "/api/reports/summary", headers: { cookie: cookie! } }));
    expect(dono.revenueCents).toBe(6000);
    const sr = await app.inject({ method: "GET", url: "/api/reports/summary", headers: { cookie: staff } });
    expect(sr.statusCode).toBe(200);
    const st = json(sr);
    expect([st.orderCount, st.topProducts[0].quantity, st.topProducts[0].productName]).toEqual([1, 2, "Pizza"]);
    for (const k of ["revenueCents", "discountCents", "averageTicketCents", "deliveryFeeCents", "tipCents", "cashSummary", "canceledCents", "openCents", "ruleChangedAt"]) {
      expect(Object.keys(st), k).not.toContain(k);
    }
    expect(sr.body).not.toMatch(/Cents"/); // nenhum valor em reais em lugar nenhum da resposta do STAFF
  });
});
