import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { computeCashSummary, type CashOrderInput } from "../src/lib/cashier";
import { makeApp, registerStore, resetDb } from "./helpers";

const order = (overrides: Partial<CashOrderInput>): CashOrderInput => ({
  type: "BALCAO",
  status: "CONCLUIDO",
  totalCents: 1000,
  deliveryFeeCents: 0,
  tipCents: 0,
  paymentMethod: "DINHEIRO",
  ...overrides,
});

describe("computeCashSummary", () => {
  it("soma só vendas em dinheiro ao saldo esperado e separa por forma de pagamento", () => {
    const summary = computeCashSummary({ openingBalanceCents: 5000, movements: [] }, [
      order({ totalCents: 2000 }),
      order({ totalCents: 3000, paymentMethod: "PIX" }),
      order({ totalCents: 500, paymentMethod: null }),
    ]);
    expect(summary.cashSalesCents).toBe(2000);
    expect(summary.expectedCents).toBe(7000);
    expect(summary.byPaymentMethod.PIX).toEqual({ count: 1, revenueCents: 3000 });
    expect(summary.byPaymentMethod.NAO_IDENTIFICADO).toEqual({ count: 1, revenueCents: 500 });
    expect(summary.sales.revenueCents).toBe(5500);
  });

  it("aplica suprimentos e sangrias e ignora pedidos cancelados", () => {
    const summary = computeCashSummary(
      {
        openingBalanceCents: 1000,
        movements: [
          { type: "SUPRIMENTO", amountCents: 500 },
          { type: "SANGRIA", amountCents: 200 },
        ],
      },
      [order({ totalCents: 800 }), order({ totalCents: 9999, status: "CANCELADO" })],
    );
    expect(summary.expectedCents).toBe(1000 + 800 + 500 - 200);
    expect(summary.sales.canceledCount).toBe(1);
    expect(summary.sales.canceledCents).toBe(9999);
    expect(summary.sales.count).toBe(1);
  });

  it("acumula taxa de entrega, gorjeta e totais por tipo de pedido", () => {
    const summary = computeCashSummary({ openingBalanceCents: 0, movements: [] }, [
      order({ type: "DELIVERY", totalCents: 2200, deliveryFeeCents: 500, tipCents: 200 }),
      order({ type: "MESA", totalCents: 1000 }),
    ]);
    expect(summary.sales.deliveryFeeCents).toBe(500);
    expect(summary.sales.tipCents).toBe(200);
    expect(summary.sales.byType.DELIVERY).toEqual({ count: 1, revenueCents: 2200 });
    expect(summary.sales.byType.MESA).toEqual({ count: 1, revenueCents: 1000 });
  });
});

describe("caixa com vendas em dinheiro (integração)", () => {
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

  async function setup(slug: string, code: string) {
    const { cookie } = await registerStore(app, { slug, code });
    const category = await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "Lanches" } });
    const product = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie: cookie! },
      payload: { categoryId: JSON.parse(category.body).category.id, name: "Combo", priceCents: 1500 },
    });
    return { cookie: cookie!, productId: JSON.parse(product.body).product.id as string };
  }

  const placeOrder = (slug: string, productId: string, extra: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/stores/${slug}/orders`,
      payload: { type: "DELIVERY", customerName: "Cliente", customerPhone: "21999990000", address: "Rua A", items: [{ productId, quantity: 1 }], ...extra },
    });

  it("fecha o caixa com esperado, diferença e observações; taxa e gorjeta entram no total", async () => {
    const { cookie, productId } = await setup("loja-caixa", "CX1");
    await app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie }, payload: { deliveryFeeCents: 500 } });

    const open = await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie }, payload: { openingBalanceCents: 5000, notes: "troco inicial" } });
    expect(open.statusCode).toBe(201);
    expect(JSON.parse(open.body).session.openingNotes).toBe("troco inicial");

    const sale = await placeOrder("loja-caixa", productId, { paymentMethod: "DINHEIRO", tipCents: 200, changeForCents: 5000 });
    expect(sale.statusCode).toBe(201);
    const pixLike = await placeOrder("loja-caixa", productId, { paymentMethod: "DEBITO", type: "BALCAO" });
    expect(pixLike.statusCode).toBe(201);

    await app.inject({ method: "POST", url: "/api/cashier/movements", headers: { cookie }, payload: { type: "SUPRIMENTO", amountCents: 1000, notes: "reforço" } });

    const current = JSON.parse((await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie } })).body);
    // 1500 (item) + 500 (taxa de entrega) + 200 (gorjeta) = 2200 em dinheiro
    expect(current.summary.cashSalesCents).toBe(2200);
    expect(current.summary.sales.deliveryFeeCents).toBe(500);
    expect(current.summary.sales.tipCents).toBe(200);
    expect(current.summary.byPaymentMethod.DEBITO.revenueCents).toBe(1500);
    expect(current.expectedBalanceCents).toBe(5000 + 2200 + 1000);

    const close = await app.inject({ method: "POST", url: "/api/cashier/close", headers: { cookie }, payload: { closingBalanceCents: 8000, notes: "faltou troco" } });
    expect(close.statusCode).toBe(200);
    const closed = JSON.parse(close.body);
    expect(closed.session.expectedClosingCents).toBe(8200);
    expect(closed.session.differenceCents).toBe(-200);
    expect(closed.session.closingNotes).toBe("faltou troco");

    const summary = await app.inject({ method: "GET", url: `/api/cashier/sessions/${closed.session.id}/summary`, headers: { cookie } });
    expect(JSON.parse(summary.body).summary.expectedCents).toBe(8200);
  });

  it("valida troco: só em dinheiro e cobrindo o total", async () => {
    const { productId } = await setup("loja-troco", "CX2");
    const tooLow = await placeOrder("loja-troco", productId, { paymentMethod: "DINHEIRO", changeForCents: 1000 });
    expect(tooLow.statusCode).toBe(400);
    const wrongMethod = await placeOrder("loja-troco", productId, { paymentMethod: "DEBITO", changeForCents: 5000 });
    expect(wrongMethod.statusCode).toBe(400);
  });

  it("caixa de outra loja não é acessível pelo resumo", async () => {
    const a = await setup("loja-cx-a", "CXA");
    const b = await registerStore(app, { slug: "loja-cx-b", code: "CXB" });
    const open = await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: a.cookie }, payload: { openingBalanceCents: 100 } });
    const sessionId = JSON.parse(open.body).session.id;
    const response = await app.inject({ method: "GET", url: `/api/cashier/sessions/${sessionId}/summary`, headers: { cookie: b.cookie! } });
    expect(response.statusCode).toBe(404);
  });
});
