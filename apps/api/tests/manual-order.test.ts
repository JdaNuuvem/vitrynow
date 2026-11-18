// API-13 — pedido lançado no painel (B2, CA-B2-01..10): servidor calcula o preço, nasce CONFIRMADO com tíquete, caixa/desconto/cupom/idempotência/isolamento.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, orderTokenHeader, registerStore, resetDb } from "./helpers";

describe("API-13 — pedido manual", () => {
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
    const productId = await product("Pizza", 4000);
    const email = `s-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email, password: "provisoria-12" } });
    const staff = ((await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria-12" } })).headers["set-cookie"] as string).split(";")[0];
    return { owner: cookie!, staff, store, productId, product };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const novo = (l: Loja, body: Record<string, unknown> = {}, cookie = l.owner, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: "/api/orders", headers: { cookie, ...headers }, payload: { type: "BALCAO", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "DEBITO", ...body } });
  const orders = (l: Loja) => prisma.order.findMany({ where: { storeId: l.store.id } });
  const abrirCaixa = (l: Loja) => app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: l.owner }, payload: { openingBalanceCents: 10000 } });
  const cupom = (l: Loja, body: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: l.owner }, payload: { code: "PROMO", discountType: "PERCENT", discountValue: 10, ...body } });

  it("CA-B2-01 FELIZ: balcão pago em débito nasce CONFIRMADO, source PAINEL, com tíquete, aparece no kanban e tem acompanhamento", async () => {
    const l = await loja();
    const r = await novo(l, { channel: "TELEFONE", alreadyPaid: true });
    expect(r.statusCode, r.body).toBe(201);
    const { orderId, code, token } = json(r);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { statusHistory: true } });
    expect([o.status, o.source, o.channel, o.totalCents, o.awaitingPayment, o.customerName]).toEqual(["CONFIRMADO", "PAINEL", "TELEFONE", 4000, false, `Balcão #${code}`]);
    expect(o.paidAt).not.toBeNull();
    expect(o.statusHistory.map((h) => h.status)).toEqual(["CONFIRMADO"]);
    expect(await prisma.printJob.count({ where: { orderId, kind: "ORDER_KITCHEN" } })).toBe(1);
    const kanban = json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: l.owner } }));
    expect(JSON.stringify(kanban)).toContain(orderId);
    const t = await app.inject({ method: "GET", url: `/stores/${l.store.slug}/orders/${orderId}/tracking`, headers: { "x-order-token": token } });
    expect(t.statusCode).toBe(200);
  });

  it("PERMISSÃO e SESSÃO: o STAFF lança pedido; sem sessão 401", async () => {
    const l = await loja();
    expect((await novo(l, {}, l.staff)).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/orders", payload: { type: "BALCAO", items: [{ productId: l.productId, quantity: 1 }] } })).statusCode).toBe(401);
  });

  it("CA-B2-03/RN-B2-03: entrega sem endereço ou sem telefone ⇒ 400 e NADA gravado; com os dois, a taxa de entrega da loja entra", async () => {
    const l = await loja();
    await prisma.store.update({ where: { id: l.store.id }, data: { deliveryFeeCents: 500 } });
    const semEnd = await novo(l, { type: "DELIVERY", customerPhone: "21999990000" });
    expect([semEnd.statusCode, json(semEnd).code]).toEqual([400, "ADDRESS_REQUIRED"]);
    const semTel = await novo(l, { type: "DELIVERY", address: "Rua A, 1" });
    expect([semTel.statusCode, json(semTel).code]).toEqual([400, "PHONE_REQUIRED"]);
    expect(await orders(l)).toHaveLength(0);
    const ok = await novo(l, { type: "DELIVERY", address: "Rua A, 1", customerPhone: "21999990000", customerName: "Ana" });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await orders(l))[0].totalCents).toBe(4500);
  });

  it("RN-B2-04: loja FECHADA ao público, modalidade desligada e pedido mínimo NÃO barram o lançamento do painel", async () => {
    const l = await loja();
    await prisma.store.update({ where: { id: l.store.id }, data: { acceptingOrders: false, pickupEnabled: false, minOrderCents: 999999 } });
    expect((await novo(l)).statusCode).toBe(201);
  });

  it("CA-B2-04/07/08: dinheiro 'já pago' sem caixa ⇒ 409 CASH_REQUIRED e nada gravado; com caixa aberto grava paidAt e soma no esperado; 'pagar na entrega' não exige caixa", async () => {
    const l = await loja();
    const sem = await novo(l, { paymentMethod: "DINHEIRO", alreadyPaid: true });
    expect([sem.statusCode, json(sem).code]).toEqual([409, "CASH_REQUIRED"]);
    expect(await orders(l)).toHaveLength(0);
    const naEntrega = await novo(l, { paymentMethod: "DINHEIRO" });
    expect(naEntrega.statusCode, naEntrega.body).toBe(201);
    expect((await orders(l))[0].paidAt).toBeNull();
    expect((await abrirCaixa(l)).statusCode).toBe(201);
    const pago = await novo(l, { paymentMethod: "DINHEIRO", alreadyPaid: true });
    expect(pago.statusCode, pago.body).toBe(201);
    const caixa = json(await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: l.owner } }));
    expect(caixa.expectedBalanceCents).toBe(10000 + 4000); // só o pago agora; o "na entrega" é "a receber"
    expect(caixa.summary.toReceiveCents).toBe(4000);
  });

  it("RN-B2-08: PIX é presencial, SEM cobrança no provedor (nenhum Payment) e sem esperar pagamento; já pago não exige forma", async () => {
    const l = await loja();
    const r = await novo(l, { paymentMethod: "PIX", alreadyPaid: true });
    expect(r.statusCode, r.body).toBe(201);
    const o = (await orders(l))[0];
    expect([o.paymentMethod, o.awaitingPayment, await prisma.payment.count({ where: { orderId: o.id } })]).toEqual(["PIX", false, 0]);
    const semForma = await novo(l, { paymentMethod: undefined, alreadyPaid: true });
    expect([semForma.statusCode, json(semForma).code]).toEqual([400, "PAYMENT_METHOD_REQUIRED"]);
  });

  it("CA-B2-05/RN-B2-06: desconto manual: STAFF até 10% passa, 15% ⇒ 403 DISCOUNT_ABOVE_LIMIT; OWNER 15% passa e fica na auditoria com o motivo; motivo é obrigatório", async () => {
    const l = await loja();
    expect((await novo(l, { discount: { percent: 10, reason: "CLIENTE_FREQUENTE" } }, l.staff)).statusCode).toBe(201);
    const alto = await novo(l, { discount: { percent: 15, reason: "CORTESIA" } }, l.staff);
    expect([alto.statusCode, json(alto).code, json(alto).limitPercent]).toEqual([403, "DISCOUNT_ABOVE_LIMIT", 10]);
    const dono = await novo(l, { discount: { percent: 15, reason: "ERRO_DO_PEDIDO" } });
    expect(dono.statusCode, dono.body).toBe(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(dono).orderId } });
    expect([o.discountCents, o.totalCents, o.manualDiscountPercent, o.manualDiscountReason]).toEqual([600, 3400, 15, "ERRO_DO_PEDIDO"]);
    const sem = await novo(l, { discount: { percent: 5, reason: "Maria da Silva pediu" } });
    expect(sem.statusCode).toBe(400);
    await new Promise((r) => setTimeout(r, 300));
    const aud = await prisma.auditLog.findFirst({ where: { storeId: l.store.id, action: "order.manual_create", targetId: o.id } });
    expect(aud?.metadata).toMatchObject({ discountPercent: 15, discountReason: "ERRO_DO_PEDIDO", role: "OWNER" });
    expect(await orders(l)).toHaveLength(2); // o recusado e o sem motivo não gravaram
  });

  it("desconto 100% + cupom nunca passa do subtotal (total só com taxa/gorjeta)", async () => {
    const l = await loja();
    expect((await cupom(l, { discountValue: 50 })).statusCode).toBe(201);
    const r = await novo(l, { couponCode: "promo", discount: { percent: 100, reason: "CORTESIA" } });
    expect(r.statusCode, r.body).toBe(201);
    const o = (await orders(l))[0];
    expect([o.discountCents, o.totalCents, o.paymentMethod]).toEqual([4000, 0, null]);
  });

  it("RN-B2-05: cupom esgotado ⇒ 400 para o STAFF; OWNER pode FORÇAR (usedCount sobe); STAFF não pode forçar; cupom inválido ⇒ 400", async () => {
    const l = await loja();
    expect((await cupom(l, { maxUses: 1 })).statusCode).toBe(201);
    expect((await novo(l, { couponCode: "PROMO" }, l.staff)).statusCode).toBe(201);
    const esgotado = await novo(l, { couponCode: "PROMO" }, l.staff);
    expect([esgotado.statusCode, json(esgotado).code]).toEqual([400, "COUPON_EXHAUSTED"]);
    const staffForca = await novo(l, { couponCode: "PROMO", forceCoupon: true }, l.staff);
    expect([staffForca.statusCode, json(staffForca).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    expect((await novo(l, { couponCode: "PROMO", forceCoupon: true })).statusCode).toBe(201);
    expect((await prisma.coupon.findFirstOrThrow({ where: { storeId: l.store.id } })).usedCount).toBe(2);
    expect((await novo(l, { couponCode: "NAOEXISTE" })).statusCode).toBe(400);
  });

  it("CA-B2-06/RN-B2-10: a MESMA Idempotency-Key devolve o MESMO pedido (200 replay), em sequência e em 6 chamadas simultâneas: um só pedido", async () => {
    const l = await loja();
    const h = { "idempotency-key": "abertura-0001-xyz" };
    const a = await novo(l, {}, l.owner, h);
    const b = await novo(l, {}, l.owner, h);
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(json(b)).toMatchObject({ orderId: json(a).orderId, replay: true });
    const h2 = { "idempotency-key": "abertura-0002-xyz" };
    const rs = await Promise.all(Array.from({ length: 6 }, () => novo(l, {}, l.owner, h2)));
    expect(rs.every((r) => r.statusCode === 200 || r.statusCode === 201)).toBe(true);
    expect(new Set(rs.map((r) => json(r).orderId)).size).toBe(1);
    expect(await orders(l)).toHaveLength(2);
    expect((await novo(l, {}, l.owner, { "idempotency-key": "curta" })).statusCode).toBe(400);
    // CONTRATO: a chave identifica a ABERTURA do formulário; a mesma chave com corpo DIFERENTE devolve o pedido antigo
    const diferente = await novo(l, { items: [{ productId: l.productId, quantity: 3 }] }, l.owner, h);
    expect([diferente.statusCode, json(diferente).orderId, json(diferente).replay]).toEqual([200, json(a).orderId, true]);
    expect((await orders(l)).find((o) => o.id === json(a).orderId)?.totalCents).toBe(4000);
  });

  it("R1 (Nightingale): o motivo do desconto é CÓDIGO de lista fechada; texto livre (nome do cliente) ⇒ 400 e nada gravado; a auditoria só leva o código", async () => {
    const l = await loja();
    for (const reason of ["Maria da Silva", "cortesia", "", "OUTRO "]) {
      expect((await novo(l, { discount: { percent: 5, reason } })).statusCode, reason).toBe(400);
    }
    expect(await orders(l)).toHaveLength(0);
    for (const reason of ["CORTESIA", "ERRO_DO_PEDIDO", "CLIENTE_FREQUENTE", "PROMOCAO_DO_DIA", "OUTRO"]) {
      expect((await novo(l, { discount: { percent: 5, reason } })).statusCode, reason).toBe(201);
    }
    await new Promise((r) => setTimeout(r, 300));
    const auds = await prisma.auditLog.findMany({ where: { storeId: l.store.id, action: "order.manual_create" } });
    expect(auds.map((a) => (a.metadata as { discountReason: string }).discountReason).sort()).toEqual(["CLIENTE_FREQUENTE", "CORTESIA", "ERRO_DO_PEDIDO", "OUTRO", "PROMOCAO_DO_DIA"]);
  });

  it("R2 (Nightingale): limite de 60 pedidos por minuto POR USUÁRIO (cada pedido imprime tíquete): o 61º ⇒ 429; outro usuário e outra loja não são afetados", async () => {
    const l = await loja();
    const outra = await loja();
    for (let i = 0; i < 60; i += 1) expect((await novo(l)).statusCode, `pedido ${i + 1}`).toBe(201);
    const estouro = await novo(l);
    expect([estouro.statusCode, json(estouro).code]).toEqual([429, "RATE_LIMITED"]);
    expect(await orders(l)).toHaveLength(60);
    expect((await novo(l, {}, l.staff)).statusCode).toBe(201); // outro usuário da mesma loja
    expect((await novo(outra)).statusCode).toBe(201); // outra loja
  }, 120000);

  it("RN-B2-12: 6 lançamentos simultâneos sem chave ⇒ 6 códigos distintos (mesma sequência, sem colisão)", async () => {
    const l = await loja();
    const rs = await Promise.all(Array.from({ length: 6 }, () => novo(l)));
    expect(rs.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(new Set(rs.map((r) => json(r).code)).size).toBe(6);
  });

  it("CA-B2-07/RN-B2-02: produto INATIVO ⇒ 400 ITEM_UNAVAILABLE; adicional de outro produto ⇒ 400; nada gravado", async () => {
    const l = await loja();
    const inativo = await l.product("Velho", 1000);
    await prisma.product.update({ where: { id: inativo }, data: { active: false } });
    const r = await novo(l, { items: [{ productId: inativo, quantity: 1 }] });
    expect([r.statusCode, json(r).code]).toEqual([400, "ITEM_UNAVAILABLE"]);
    const ad = await novo(l, { items: [{ productId: l.productId, quantity: 1, additionalIds: ["cnaoexiste000000000000000"] }] });
    expect(ad.statusCode).toBe(400);
    expect(await orders(l)).toHaveLength(0);
  });

  it("CA-B2-10 ISOLAMENTO: produto de OUTRA loja ⇒ 400 e nada gravado em nenhuma das duas; o dono da outra loja não vê o pedido", async () => {
    const a = await loja();
    const b = await loja();
    const r = await novo(a, { items: [{ productId: b.productId, quantity: 1 }] });
    expect([r.statusCode, json(r).code]).toEqual([400, "PRODUCT_NOT_FOUND"]);
    expect([(await orders(a)).length, (await orders(b)).length]).toEqual([0, 0]);
    const ok = await novo(a);
    const orderId = json(ok).orderId as string;
    expect((await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: { cookie: b.owner } })).statusCode).toBe(404);
  });

  it("o servidor decide o preço: o cliente não manda valor; troco só em dinheiro e cobrindo o total; total 0 ignora a forma de pagamento", async () => {
    const l = await loja();
    const semDinheiro = await novo(l, { changeForCents: 5000 });
    expect(semDinheiro.statusCode).toBe(400);
    const curto = await novo(l, { paymentMethod: "DINHEIRO", changeForCents: 1000 });
    expect(curto.statusCode).toBe(400);
    expect((await novo(l, { paymentMethod: "DINHEIRO", changeForCents: 5000 })).statusCode).toBe(201);
    const zero = await novo(l, { paymentMethod: "PIX", alreadyPaid: true, discount: { percent: 100, reason: "OUTRO" } });
    expect(zero.statusCode, zero.body).toBe(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(zero).orderId } });
    expect([o.totalCents, o.paymentMethod, o.paidAt]).toEqual([0, null, null]);
  });

  it("tem token de acompanhamento só na criação; o pedido manual aceita o fluxo normal (avançar até CONCLUIDO)", async () => {
    const l = await loja();
    await abrirCaixa(l);
    const r = await novo(l, { paymentMethod: "DINHEIRO" });
    const id = json(r).orderId as string;
    expect(Object.keys(orderTokenHeader(id))).toBeDefined();
    for (const to of ["EM_PREPARO", "PRONTO", "CONCLUIDO"]) expect((await app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie: l.owner }, payload: { to } })).statusCode, to).toBe(200);
    const caixa = json(await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: l.owner } }));
    expect(caixa.expectedBalanceCents).toBe(14000); // recebido ao concluir (API-21)
  });
});
