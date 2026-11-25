// API-24 — receber a mesa (ADR-0012; RN-MB-02..05; CA-MB-02/03/04/05/12/13): 1 forma de pagamento, venda reconhecida no RECEBIMENTO, caixa só com dinheiro recebido.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-24 — receber a mesa", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    resetLimits();
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

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const product = async (name: string, priceCents: number) => json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name, priceCents } })).product.id as string;
    const p40 = await product("Pizza", 4000);
    const p25 = await product("Massa", 2500);
    const p15 = await product("Suco", 1500);
    const email = `s-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email, password: "provisoria-12" } });
    const staff = ((await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria-12" } })).headers["set-cookie"] as string).split(";")[0];
    const mesa = json(await app.inject({ method: "POST", url: "/api/tables", headers: { cookie: cookie! }, payload: { label: "4" } })).table as { id: string; qrToken: string };
    return { owner: cookie!, staff, store, p40, p25, p15, mesa };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  // pedido de cliente pelo QR, aceito pela equipe (PENDENTE -> CONFIRMADO), como em produção
  async function pedidoAceito(l: Loja, productId: string, mesa = l.mesa, aceitar = true) {
    resetLimits();
    const r = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/tables/${mesa.qrToken}/orders`, payload: { items: [{ productId, quantity: 1 }] } });
    expect(r.statusCode, r.body).toBe(201);
    const id = json(r).orderId as string;
    if (aceitar) {
      const t = await app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie: l.staff }, payload: { to: "CONFIRMADO" } });
      expect(t.statusCode, t.body).toBe(200);
    }
    return id;
  }
  const receber = (l: Loja, body: Record<string, unknown>, cookie = l.staff, mesa = l.mesa) =>
    app.inject({ method: "POST", url: `/api/tables/${mesa.id}/receive`, headers: { cookie }, payload: body });
  const abrirCaixa = (l: Loja, opening = 10000) => app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: l.owner }, payload: { openingBalanceCents: opening } });
  const relatorio = async (l: Loja) => json(await app.inject({ method: "GET", url: "/api/reports/summary", headers: { cookie: l.owner } }));
  const caixa = async (l: Loja) => json(await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: l.owner } }));
  const conta = async (l: Loja, mesa = l.mesa) => json(await app.inject({ method: "GET", url: `/api/tables/${mesa.id}/account`, headers: { cookie: l.staff } }));

  it("CA-MB-02 FELIZ: 3 pedidos aceitos (40+25+15) recebidos em PIX => 1 Receipt de 80,00 com 1 pagamento; pedidos marcados; mesa livre; venda conta 1x, no recebimento", async () => {
    const l = await loja();
    const ids = [await pedidoAceito(l, l.p40), await pedidoAceito(l, l.p25), await pedidoAceito(l, l.p15)];
    const c = await conta(l);
    expect([c.totalCents, c.orders.length, c.pendingOrders]).toEqual([8000, 3, 0]);
    const r = await receber(l, { paymentMethod: "PIX", expectedTotalCents: 8000 });
    expect(r.statusCode, r.body).toBe(201);
    expect(json(r).receipt).toMatchObject({ totalCents: 8000, method: "PIX" });
    const receipt = await prisma.receipt.findFirstOrThrow({ where: { storeId: l.store.id }, include: { payments: true } });
    expect([receipt.kind, receipt.totalCents, receipt.serviceFeeCents, receipt.discountCents, receipt.payments.length, receipt.payments[0].method, receipt.payments[0].amountCents]).toEqual(["TABLE", 8000, 0, 0, 1, "PIX", 8000]);
    const pedidos = await prisma.order.findMany({ where: { id: { in: ids } } });
    expect(pedidos.every((o) => o.receiptId === receipt.id && o.paidAt !== null)).toBe(true);
    const lista = json(await app.inject({ method: "GET", url: "/api/tables", headers: { cookie: l.owner } }));
    expect(lista.tables[0]).toMatchObject({ free: true, accountCents: 0, accountOrders: 0 });
    const rel = await relatorio(l);
    expect([rel.orderCount, rel.revenueCents, rel.byType.MESA, rel.byPaymentMethod.PIX]).toEqual([1, 8000, { count: 1, revenueCents: 8000 }, { count: 1, revenueCents: 8000 }]);
    expect(rel.topProducts.map((p: { productName: string }) => p.productName).sort()).toEqual(["Massa", "Pizza", "Suco"]);
  });

  it("CA-MB-03: pedido cancelado sai da conta (40+25 = 65; o de 15 cancelado)", async () => {
    const l = await loja();
    await pedidoAceito(l, l.p40);
    await pedidoAceito(l, l.p25);
    const cancelado = await pedidoAceito(l, l.p15);
    const c = await app.inject({ method: "POST", url: `/api/orders/${cancelado}/cancel`, headers: { cookie: l.staff }, payload: { reason: { code: "CLIENTE_DESISTIU" } } });
    expect(c.statusCode, c.body).toBe(200);
    expect((await conta(l)).totalCents).toBe(6500);
    const r = await receber(l, { paymentMethod: "DEBITO" });
    expect(json(r).receipt.totalCents).toBe(6500);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: cancelado } })).receiptId).toBeNull();
    expect((await relatorio(l)).canceledCount).toBe(1);
  });

  it("CA-MB-04: dinheiro sem caixa aberto => 409 CASH_REQUIRED (nada gravado); com caixa, o esperado soma o total recebido; troco registrado", async () => {
    const l = await loja();
    await pedidoAceito(l, l.p40);
    const sem = await receber(l, { paymentMethod: "DINHEIRO" });
    expect([sem.statusCode, json(sem).code]).toEqual([409, "CASH_REQUIRED"]);
    expect(await prisma.receipt.count()).toBe(0);
    expect((await conta(l)).totalCents).toBe(4000);
    await abrirCaixa(l, 10000);
    const baixo = await receber(l, { paymentMethod: "DINHEIRO", changeForCents: 3000 });
    expect([baixo.statusCode, json(baixo).code]).toEqual([400, "CHANGE_TOO_LOW"]);
    const ok = await receber(l, { paymentMethod: "DINHEIRO", changeForCents: 5000 });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(json(ok).receipt).toMatchObject({ totalCents: 4000, changeDueCents: 1000 });
    const atual = await caixa(l);
    expect(atual.expectedBalanceCents).toBe(14000); // abertura 100,00 + 40,00 aplicados à conta (o troco não entra na gaveta)
    const sid = atual.session.id as string;
    const resumo = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${sid}/summary`, headers: { cookie: l.owner } }));
    expect(resumo.summary.sales.byType.MESA).toEqual({ count: 1, revenueCents: 4000 });
  });

  it("CA-MB-05: pedido de mesa SEM recebimento => receita 0 e caixa 0", async () => {
    const l = await loja();
    await abrirCaixa(l, 10000);
    await pedidoAceito(l, l.p40);
    await pedidoAceito(l, l.p25, l.mesa, false); // PENDENTE
    const rel = await relatorio(l);
    expect([rel.orderCount, rel.revenueCents, rel.openCount]).toEqual([0, 0, 0]);
    expect(rel.byType.MESA).toBeUndefined();
    const atual = await caixa(l);
    expect(atual.expectedBalanceCents).toBe(10000);
    const resumo = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${atual.session.id}/summary`, headers: { cookie: l.owner } }));
    expect([resumo.summary.sales.count, resumo.summary.sales.revenueCents]).toEqual([0, 0]);
  });

  it("CA-MB-13: pedido PENDENTE bloqueia o recebimento (PENDING_ORDERS) até aceitar ou recusar", async () => {
    const l = await loja();
    await pedidoAceito(l, l.p40);
    const pendente = await pedidoAceito(l, l.p25, l.mesa, false);
    const r = await receber(l, { paymentMethod: "PIX" });
    expect([r.statusCode, json(r).code, json(r).details]).toEqual([409, "PENDING_ORDERS", { pendingOrders: 1 }]);
    await app.inject({ method: "POST", url: `/api/orders/${pendente}/cancel`, headers: { cookie: l.staff }, payload: { reason: { code: "CLIENTE_DESISTIU" } } });
    expect((await receber(l, { paymentMethod: "PIX" })).statusCode).toBe(201);
  });

  it("CA-MB-12: pedido já recebido não se cancela (ORDER_ALREADY_RECEIVED)", async () => {
    const l = await loja();
    const id = await pedidoAceito(l, l.p40);
    await receber(l, { paymentMethod: "PIX" });
    const c = await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: l.owner }, payload: { reason: { code: "CLIENTE_DESISTIU" } } });
    expect([c.statusCode, json(c).code]).toEqual([409, "ORDER_ALREADY_RECEIVED"]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).not.toBe("CANCELADO");
  });

  it("conta mudou: expectedTotalCents diferente => 409 TOTAL_CHANGED com o total atual; mesa vazia => NOTHING_TO_RECEIVE; segundo recebimento da mesma conta => NOTHING_TO_RECEIVE", async () => {
    const l = await loja();
    const vazia = await receber(l, { paymentMethod: "PIX" });
    expect([vazia.statusCode, json(vazia).code]).toEqual([409, "NOTHING_TO_RECEIVE"]);
    await pedidoAceito(l, l.p40);
    const velho = await receber(l, { paymentMethod: "PIX", expectedTotalCents: 2500 });
    expect([velho.statusCode, json(velho).code, json(velho).details]).toEqual([409, "TOTAL_CHANGED", { totalCents: 4000 }]);
    expect((await receber(l, { paymentMethod: "PIX", expectedTotalCents: 4000 })).statusCode).toBe(201);
    const dois = await receber(l, { paymentMethod: "PIX" });
    expect([dois.statusCode, json(dois).code]).toEqual([409, "NOTHING_TO_RECEIVE"]);
    expect(await prisma.receipt.count()).toBe(1);
  });

  it("CONCORRÊNCIA: dois recebimentos simultâneos da mesma mesa geram UM Receipt", async () => {
    const l = await loja();
    await pedidoAceito(l, l.p40);
    await pedidoAceito(l, l.p25);
    const [a, b] = await Promise.all([receber(l, { paymentMethod: "PIX" }), receber(l, { paymentMethod: "DEBITO" })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await prisma.receipt.count()).toBe(1);
    expect(await prisma.receiptPayment.count()).toBe(1);
  });

  it("entrada inválida: corpo estrito (taxa só pelo percentual da loja), forma ausente ou dupla, troco fora do dinheiro", async () => {
    const l = await loja();
    await pedidoAceito(l, l.p40);
    for (const body of [
      {},
      { paymentMethod: "PIX", serviceFeeCents: 500 }, // a taxa nunca vem em centavos do cliente
      { paymentMethod: "PIX", discountCents: -1 },
      { paymentMethod: "PIX", payments: [{ method: "PIX", amountCents: 2000 }, { method: "DEBITO", amountCents: 2000 }] }, // as duas formas ao mesmo tempo
      { payments: [{ method: "PIX", amountCents: 4000 }] }, // dividir exige 2 ou mais partes
      { payments: [{ method: "PIX", amountCents: 2000 }, { method: "DINHEIRO", amountCents: 2000 }], changeForCents: 5000 }, // troco vai na parte
      { paymentMethod: "BITCOIN" },
    ]) {
      expect((await receber(l, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(json(await receber(l, { paymentMethod: "PIX", changeForCents: 5000 })).code).toBe("CHANGE_ONLY_CASH");
    expect(await prisma.receipt.count()).toBe(0);
  });

  it("TAXA DE SERVIÇO e DESCONTO (todos os planos): 10% padrão opcional; desconto em R$; total = conta + taxa - desconto; relatório separa", async () => {
    const l = await loja();
    await pedidoAceito(l, l.p40);
    await pedidoAceito(l, l.p25); // conta 65,00
    const r = await receber(l, { paymentMethod: "PIX", expectedTotalCents: 6500, includeServiceFee: true, discountCents: 150 }, l.owner);
    expect(r.statusCode, r.body).toBe(201);
    expect(json(r).receipt).toMatchObject({ subtotalCents: 6500, serviceFeeCents: 650, discountCents: 150, totalCents: 7000, method: "PIX" });
    const receipt = await prisma.receipt.findFirstOrThrow({ include: { payments: true } });
    expect([receipt.subtotalCents, receipt.serviceFeeCents, receipt.discountCents, receipt.totalCents, receipt.payments[0].amountCents]).toEqual([6500, 650, 150, 7000, 7000]);
    const rel = await relatorio(l);
    expect([rel.revenueCents, rel.serviceFeeCents, rel.discountCents]).toEqual([7000, 650, 150]);
  });

  it("taxa: percentual configurável pela loja (0 = não cobra); desconto do STAFF limitado ao percentual da loja; desconto não zera a conta", async () => {
    const l = await loja();
    const cfg = await app.inject({ method: "POST", url: "/api/store/qr-settings", headers: { cookie: l.owner }, payload: { serviceFeePercent: 0 } });
    expect([cfg.statusCode, json(cfg).settings.serviceFeePercent]).toEqual([200, 0]);
    await pedidoAceito(l, l.p40); // conta 40,00
    expect(json(await receber(l, { paymentMethod: "PIX", includeServiceFee: true })).code).toBe("SERVICE_FEE_DISABLED");
    expect((await app.inject({ method: "POST", url: "/api/store/qr-settings", headers: { cookie: l.owner }, payload: { serviceFeePercent: 31 } })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/store/qr-settings", headers: { cookie: l.owner }, payload: { serviceFeePercent: 12 } });
    // limite padrão do STAFF: 10% (de 40,00 = 4,00)
    const acima = await receber(l, { paymentMethod: "PIX", discountCents: 401 });
    expect([acima.statusCode, json(acima).code]).toEqual([403, "DISCOUNT_ABOVE_LIMIT"]);
    expect([(await receber(l, { paymentMethod: "PIX", discountCents: 4000 }, l.owner)).statusCode]).toEqual([400]); // DISCOUNT_TOO_HIGH
    expect(await prisma.receipt.count()).toBe(0);
    const ok = await receber(l, { paymentMethod: "PIX", includeServiceFee: true, discountCents: 400 });
    expect(json(ok).receipt).toMatchObject({ subtotalCents: 4000, serviceFeeCents: 480, discountCents: 400, totalCents: 4080 });
  });

  it("DIVIDIR A CONTA (PRO, tab_service): partes somam o total; dinheiro exige caixa e troco por parte; soma errada é 400; caixa conta só o dinheiro", async () => {
    const l = await loja();
    await pedidoAceito(l, l.p40);
    await pedidoAceito(l, l.p25); // conta 65,00 + 10% = 71,50
    const partes = [{ method: "PIX", amountCents: 4000 }, { method: "DINHEIRO", amountCents: 3150, changeForCents: 5000 }];
    expect(json(await receber(l, { payments: partes, includeServiceFee: true })).code).toBe("CASH_REQUIRED");
    await abrirCaixa(l, 10000);
    const errada = await receber(l, { payments: [{ method: "PIX", amountCents: 4000 }, { method: "DEBITO", amountCents: 3000 }], includeServiceFee: true });
    expect([errada.statusCode, json(errada).code, json(errada).details]).toEqual([400, "PAYMENTS_MISMATCH", { totalCents: 7150, paidCents: 7000 }]);
    const ok = await receber(l, { payments: partes, includeServiceFee: true });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(json(ok).receipt.payments).toEqual([
      { method: "PIX", amountCents: 4000, changeForCents: null, changeDueCents: null },
      { method: "DINHEIRO", amountCents: 3150, changeForCents: 5000, changeDueCents: 1850 },
    ]);
    expect(await prisma.receiptPayment.count()).toBe(2);
    expect((await caixa(l)).expectedBalanceCents).toBe(13150); // abertura + só a parte em dinheiro
    const rel = await relatorio(l);
    expect([rel.orderCount, rel.revenueCents, rel.byPaymentMethod.PIX, rel.byPaymentMethod.DINHEIRO]).toEqual([1, 7150, { count: 1, revenueCents: 4000 }, { count: 1, revenueCents: 3150 }]);
  });

  it("DIVIDIR A CONTA fora do PRO: 402 FEATURE_LOCKED e nada gravado; uma forma só continua livre", async () => {
    const { cookie } = await registerStore(app, { plan: "BASICO" });
    const mesa = json(await app.inject({ method: "POST", url: "/api/tables", headers: { cookie: cookie! }, payload: { label: "1" } })).table as { id: string };
    const r = await app.inject({ method: "POST", url: `/api/tables/${mesa.id}/receive`, headers: { cookie: cookie! }, payload: { payments: [{ method: "PIX", amountCents: 100 }, { method: "DEBITO", amountCents: 100 }] } });
    expect([r.statusCode, json(r).code, json(r).feature]).toEqual([402, "FEATURE_LOCKED", "tab_service"]);
    expect(await prisma.receipt.count()).toBe(0);
  });

  it("PERMISSÃO e ISOLAMENTO: STAFF recebe; sem sessão 401; loja B não recebe nem vê a conta da mesa da loja A (404)", async () => {
    const a = await loja();
    const b = await loja();
    await pedidoAceito(a, a.p40);
    expect((await app.inject({ method: "POST", url: `/api/tables/${a.mesa.id}/receive`, payload: { paymentMethod: "PIX" } })).statusCode).toBe(401);
    expect((await receber(b, { paymentMethod: "PIX" }, b.owner, a.mesa)).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/tables/${a.mesa.id}/account`, headers: { cookie: b.owner } })).statusCode).toBe(404);
    expect(await prisma.receipt.count()).toBe(0);
    expect((await receber(a, { paymentMethod: "CREDITO" }, a.staff)).statusCode).toBe(201);
    expect((await prisma.receipt.findFirstOrThrow()).receivedByUserId).not.toBe("");
  });

  it("a conta da mesa e o total são da EQUIPE: o cliente do QR nunca os recebe (CA-MB-06/07 segue valendo depois do recebimento)", async () => {
    const l = await loja();
    await pedidoAceito(l, l.p40);
    const semToken = json(await app.inject({ method: "GET", url: `/stores/${l.store.slug}/tables/${l.mesa.qrToken}/my-orders` }));
    expect(semToken.orders).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/stores/${l.store.slug}/tables/${l.mesa.qrToken}/account` })).statusCode).toBe(404);
  });
});
