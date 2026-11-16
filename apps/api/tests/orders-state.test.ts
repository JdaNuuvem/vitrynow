// API-02 — máquina de estados, cancelamento com motivo, saga de estorno, desfazer (contrato b3 / ADR-0007).
// Mercado Pago é SEMPRE mockado.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { login, makeApp, registerStore, resetDb } from "./helpers";
import { subscribe } from "../src/realtime/hub";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
const refundPayment = vi.mocked(mp.refundPayment);
const cancelPayment = vi.mocked(mp.cancelPayment);
const getPayment = vi.mocked(mp.getPayment);

type App = ReturnType<typeof makeApp>;

describe("API-02 — estados do pedido", () => {
  let app: App;
  beforeEach(async () => {
    vi.clearAllMocks();
    refundPayment.mockResolvedValue(undefined);
    cancelPayment.mockResolvedValue(undefined);
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

  async function setup() {
    const { cookie, response, credentials } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(
      await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } }),
    ).product.id as string;
    return { cookie: cookie!, storeId: storeId as string, slug: slug as string, productId, credentials };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  async function staffCookie(ctx: Ctx) {
    const invited = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: ctx.cookie }, payload: { email: `staff-${Date.now()}@t.com`, password: "provisoria1" } });
    expect(invited.statusCode).toBe(201);
    const email = json(invited).user.email as string;
    return (await login(app, email, "provisoria1")).cookie!;
  }

  async function newOrder(ctx: Ctx, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: "POST",
      url: `/stores/${ctx.slug}/orders`,
      payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], ...extra },
    });
    expect(res.statusCode).toBe(201);
    return json(res).orderId as string;
  }

  // Pedido com PIX já aprovado (estado resultante do webhook; o webhook em si é API-03).
  async function paidOrder(ctx: Ctx, extra: Record<string, unknown> = {}) {
    const orderId = await newOrder(ctx, extra);
    await prisma.order.update({ where: { id: orderId }, data: { paymentMethod: "PIX", awaitingPayment: false } });
    await prisma.payment.create({ data: { orderId, providerPaymentId: `mp-${orderId}`, amountCents: 1000, status: "APROVADO" } });
    return orderId;
  }

  const transition = (cookie: string, id: string, to: string) =>
    app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie }, payload: { to } });
  const cancel = (cookie: string, id: string, reason?: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie }, payload: reason ? { reason } : {} });
  const undo = (cookie: string, id: string) => app.inject({ method: "POST", url: `/api/orders/${id}/undo`, headers: { cookie } });
  const customerCancel = (slug: string, id: string) => app.inject({ method: "POST", url: `/stores/${slug}/orders/${id}/cancel` });

  // ───────────── Avançar ─────────────
  it("BALCAO percorre PENDENTE→…→CONCLUIDO e grava autor/origem no histórico; DELIVERY passa por SAIU_PARA_ENTREGA", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]) {
      const r = await transition(ctx.cookie, id, to);
      expect(r.statusCode, to).toBe(200);
      expect(json(r).order.status).toBe(to);
    }
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { seq: "asc" } });
    expect(history.map((h) => h.status)).toEqual(["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]);
    expect(history.slice(1).every((h) => h.source === "PANEL" && h.userId && h.kind === "ADVANCE")).toBe(true);

    const del = await newOrder(ctx, { type: "DELIVERY", customerName: "A", customerPhone: "11999999999", address: "Rua 1" });
    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO"]) await transition(ctx.cookie, del, to);
    expect((await transition(ctx.cookie, del, "CONCLUIDO")).statusCode).toBe(409); // delivery precisa SAIR antes
    expect(json(await transition(ctx.cookie, del, "SAIU_PARA_ENTREGA")).order.status).toBe("SAIU_PARA_ENTREGA");
    expect(json(await transition(ctx.cookie, del, "CONCLUIDO")).order.status).toBe("CONCLUIDO");
  });

  it("recusa saltos, retrocessos, retirada com SAIU_PARA_ENTREGA e estado final (INVALID_TRANSITION)", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    for (const to of ["EM_PREPARO", "PRONTO", "CONCLUIDO", "PENDENTE", "CANCELADO", "SAIU_PARA_ENTREGA"]) {
      const r = await transition(ctx.cookie, id, to);
      expect(r.statusCode, to).toBe(409);
      expect(json(r).code).toBe("INVALID_TRANSITION");
    }
    expect((await transition(ctx.cookie, id, "ABACATE")).statusCode).toBe(400);
  });

  it("não aceita pedido que ainda aguarda pagamento", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    await prisma.order.update({ where: { id }, data: { awaitingPayment: true } });
    expect(json(await transition(ctx.cookie, id, "CONFIRMADO")).code).toBe("INVALID_TRANSITION");
  });

  it("duas pessoas aceitando ao mesmo tempo: uma vence, a outra recebe 409", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    const [a, b] = await Promise.all([transition(ctx.cookie, id, "CONFIRMADO"), transition(ctx.cookie, id, "CONFIRMADO")]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(["ORDER_STATE_CHANGED", "INVALID_TRANSITION"]).toContain(json(a.statusCode === 409 ? a : b).code);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: id, status: "CONFIRMADO" } })).toBe(1);
  });

  it("isolamento: loja B não age sobre pedido da loja A (404 ORDER_NOT_FOUND)", async () => {
    const a = await setup();
    const b = await setup();
    const id = await newOrder(a);
    for (const r of [await transition(b.cookie, id, "CONFIRMADO"), await cancel(b.cookie, id, { code: "ITEM_EM_FALTA" }), await undo(b.cookie, id)]) {
      expect(r.statusCode).toBe(404);
      expect(json(r).code).toBe("ORDER_NOT_FOUND");
    }
    expect((await prisma.order.findUnique({ where: { id } }))?.status).toBe("PENDENTE");
  });

  it("a listagem do painel traz allowedTransitions, canUndo e payment.refundPending", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    const list = json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: ctx.cookie } })).orders;
    const o = list.find((x: { id: string }) => x.id === id);
    expect(o.allowedTransitions.map((t: { to: string }) => t.to)).toEqual(["CONFIRMADO", "CANCELADO"]);
    expect(o.allowedTransitions[1].requires).toEqual({ reason: true, owner: false, mfa: false, refund: false });
    expect(o.canUndo).toBe(false);
    expect(o.cancel).toBeNull();
  });

  // ───────────── Cancelar sem dinheiro ─────────────
  it("cancelar exige motivo válido; PAGAMENTO_NAO_APROVADO é só do sistema; OUTRO exige texto", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    expect(json(await cancel(ctx.cookie, id)).code).toBe("REASON_REQUIRED");
    expect(json(await cancel(ctx.cookie, id, { code: "OUTRO" })).code).toBe("REASON_REQUIRED");
    expect(json(await cancel(ctx.cookie, id, { code: "PAGAMENTO_NAO_APROVADO" })).code).toBe("REASON_INVALID");
    expect(json(await cancel(ctx.cookie, id, { code: "INVENTADO" })).code).toBe("REASON_INVALID");
    expect((await prisma.order.findUnique({ where: { id } }))?.status).toBe("PENDENTE");
  });

  it("cancelar grava motivo e mensagem ao cliente, devolve o cupom UMA vez e bloqueia qualquer novo movimento", async () => {
    const ctx = await setup();
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.cookie }, payload: { code: "DEZ", discountType: "FIXED", discountValue: 100 } });
    const id = await newOrder(ctx, { couponCode: "DEZ" });
    expect((await prisma.coupon.findFirst({ where: { storeId: ctx.storeId } }))?.usedCount).toBe(1);

    const res = await cancel(ctx.cookie, id, { code: "ITEM_EM_FALTA", customerMessage: "Acabou o pão" });
    expect(res.statusCode).toBe(200);
    const body = json(res).order;
    expect(body.status).toBe("CANCELADO");
    expect(body.cancel).toMatchObject({ reasonCode: "ITEM_EM_FALTA", customerMessage: "Acabou o pão", by: "OWNER" });
    expect(body.allowedTransitions).toEqual([]);
    expect(body.canUndo).toBe(false);
    expect((await prisma.coupon.findFirst({ where: { storeId: ctx.storeId } }))?.usedCount).toBe(0);

    expect(json(await cancel(ctx.cookie, id, { code: "ITEM_EM_FALTA" })).code).toBe("INVALID_TRANSITION");
    expect(json(await transition(ctx.cookie, id, "CONCLUIDO")).code).toBe("INVALID_TRANSITION");
    expect(json(await undo(ctx.cookie, id)).code).toBe("INVALID_TRANSITION");
    expect((await prisma.coupon.findFirst({ where: { storeId: ctx.storeId } }))?.usedCount).toBe(0);
  });

  it("STAFF recusa PENDENTE e cancela CONFIRMADO, mas não cancela em preparo nem pedido pago", async () => {
    const ctx = await setup();
    const staff = await staffCookie(ctx);
    const a = await newOrder(ctx);
    expect((await cancel(staff, a, { code: "CLIENTE_DESISTIU" })).statusCode).toBe(200);

    const b = await newOrder(ctx);
    await transition(ctx.cookie, b, "CONFIRMADO");
    expect((await cancel(staff, b, { code: "ITEM_EM_FALTA" })).statusCode).toBe(200);

    const c = await newOrder(ctx);
    await transition(ctx.cookie, c, "CONFIRMADO");
    await transition(ctx.cookie, c, "EM_PREPARO");
    const denied = await cancel(staff, c, { code: "ITEM_EM_FALTA" });
    expect(denied.statusCode).toBe(403);
    expect(json(denied).code).toBe("FORBIDDEN_ROLE");

    const paid = await paidOrder(ctx);
    const deniedPaid = await cancel(staff, paid, { code: "ITEM_EM_FALTA" });
    expect(deniedPaid.statusCode).toBe(403);
    expect(json(deniedPaid).code).toBe("FORBIDDEN_ROLE");
    expect(refundPayment).not.toHaveBeenCalled();
    expect((await prisma.payment.findUnique({ where: { orderId: paid } }))?.status).toBe("APROVADO");
  });

  it("cancelar pedido com cobrança PIX ainda aberta cancela a cobrança no provedor", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    await prisma.payment.create({ data: { orderId: id, providerPaymentId: "mp-aberto", amountCents: 1000, status: "PENDENTE" } });
    expect((await cancel(ctx.cookie, id, { code: "CLIENTE_DESISTIU" })).statusCode).toBe(200);
    expect(cancelPayment).toHaveBeenCalledWith("mp-aberto");
    expect((await prisma.payment.findUnique({ where: { orderId: id } }))?.status).toBe("CANCELADO");
  });

  it("falha ao cancelar a cobrança aberta não desfaz o cancelamento do pedido (RN-B3-02)", async () => {
    const ctx = await setup();
    cancelPayment.mockRejectedValueOnce(new Error("MP fora do ar"));
    const id = await newOrder(ctx);
    await prisma.payment.create({ data: { orderId: id, providerPaymentId: "mp-aberto2", amountCents: 1000, status: "PENDENTE" } });
    expect((await cancel(ctx.cookie, id, { code: "CLIENTE_DESISTIU" })).statusCode).toBe(200);
    expect((await prisma.order.findUnique({ where: { id } }))?.status).toBe("CANCELADO");
  });

  // ───────────── Saga de estorno ─────────────
  it("OWNER cancela pedido com PIX aprovado: estorna, marca REEMBOLSADO e cancela (nunca CANCELADO com APROVADO)", async () => {
    const ctx = await setup();
    const id = await paidOrder(ctx);
    const res = await cancel(ctx.cookie, id, { code: "ITEM_EM_FALTA" });
    expect(res.statusCode).toBe(200);
    expect(json(res).refund).toBe("DONE");
    expect(refundPayment).toHaveBeenCalledTimes(1);
    const paymentId = (await prisma.payment.findUnique({ where: { orderId: id } }))!.id;
    expect(refundPayment).toHaveBeenCalledWith(`mp-${id}`, `refund-${paymentId}`); // chave idempotente deterministica
    const order = await prisma.order.findUnique({ where: { id }, include: { payment: true } });
    expect({ status: order?.status, payment: order?.payment?.status }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO" });
  });

  it("estorno que falha: pedido NÃO muda, vira estorno pendente (202), bloqueia avanço e a nova tentativa conclui", async () => {
    const ctx = await setup();
    const id = await paidOrder(ctx);
    refundPayment.mockRejectedValueOnce(new Error("timeout"));
    const res = await cancel(ctx.cookie, id, { code: "ITEM_EM_FALTA" });
    expect(res.statusCode).toBe(202);
    expect(json(res).refund).toBe("PENDING");
    expect(json(res).order.payment).toMatchObject({ status: "ESTORNO_PENDENTE", refundPending: true });
    expect(json(res).order.payment.refundLastError).toBeTruthy();
    expect(JSON.stringify(json(res))).not.toContain("timeout"); // detalhe técnico não vaza
    expect((await prisma.order.findUnique({ where: { id } }))?.status).toBe("PENDENTE");

    expect(json(await transition(ctx.cookie, id, "CONFIRMADO")).code).toBe("REFUND_PENDING");
    expect(json(await undo(ctx.cookie, id)).code).toBe("REFUND_PENDING");

    const retry = await app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie: ctx.cookie } });
    expect(retry.statusCode).toBe(200);
    expect(json(retry).refund).toBe("DONE");
    const after = await prisma.order.findUnique({ where: { id }, include: { payment: true, statusHistory: { orderBy: { seq: "desc" }, take: 1 } } });
    expect({ status: after?.status, payment: after?.payment?.status, attempts: after?.payment?.refundAttempts }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO", attempts: 1 });
    expect(after?.statusHistory[0]).toMatchObject({ kind: "CANCEL", reasonCode: "ITEM_EM_FALTA", source: "PANEL" });
  });

  it("C1 (Nightingale): provedor já estornou mas a resposta se perdeu ⇒ a nova tentativa consulta o provedor e conclui (nunca fica preso)", async () => {
    const ctx = await setup();
    const id = await paidOrder(ctx);
    refundPayment.mockRejectedValueOnce(new Error("conexão caiu depois do aceite")); // MP estornou, nós não soubemos
    expect((await cancel(ctx.cookie, id, { code: "ITEM_EM_FALTA" })).statusCode).toBe(202);

    refundPayment.mockRejectedValueOnce(new Error("already refunded"));
    getPayment.mockResolvedValueOnce({ providerPaymentId: `mp-${id}`, status: "refunded" });
    const retry = await app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie: ctx.cookie } });
    expect(retry.statusCode).toBe(200);
    expect(json(retry).refund).toBe("DONE");
    const o = await prisma.order.findUnique({ where: { id }, include: { payment: true } });
    expect({ status: o?.status, payment: o?.payment?.status }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO" });
  });

  it("estorno recusado e provedor ainda 'approved' (ou a consulta falha) ⇒ continua pendente, sem concluir", async () => {
    const ctx = await setup();
    const id = await paidOrder(ctx);
    refundPayment.mockRejectedValue(new Error("saldo insuficiente"));
    getPayment.mockResolvedValueOnce({ providerPaymentId: `mp-${id}`, status: "approved" });
    expect((await cancel(ctx.cookie, id, { code: "ITEM_EM_FALTA" })).statusCode).toBe(202);
    getPayment.mockRejectedValueOnce(new Error("MP fora"));
    const retry = await app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie: ctx.cookie } });
    expect(retry.statusCode).toBe(202);
    const o = await prisma.order.findUnique({ where: { id }, include: { payment: true } });
    expect({ status: o?.status, payment: o?.payment?.status, attempts: o?.payment?.refundAttempts }).toEqual({ status: "PENDENTE", payment: "ESTORNO_PENDENTE", attempts: 2 });
  });

  it("duas tentativas de estorno simultâneas (retry manual + job): sem 5xx e efeitos uma única vez", async () => {
    const ctx = await setup();
    const id = await paidOrder(ctx);
    refundPayment.mockRejectedValueOnce(new Error("timeout"));
    await cancel(ctx.cookie, id, { code: "ITEM_EM_FALTA" });
    const sent: string[] = [];
    const socket = { readyState: 1, OPEN: 1, send: (m: string) => sent.push(m), on: vi.fn() };
    subscribe(ctx.storeId, socket as never);

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie: ctx.cookie } }),
      app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie: ctx.cookie } }),
    ]);
    for (const r of [a, b]) expect([200, 409]).toContain(r.statusCode); // a segunda pode chegar com o estorno já concluído
    expect(await prisma.orderStatusHistory.count({ where: { orderId: id, kind: "CANCEL" } })).toBe(1);
    expect(sent.filter((m) => m.includes("payment.refund_done"))).toHaveLength(1);
    expect((await prisma.payment.findUnique({ where: { orderId: id } }))?.status).toBe("REEMBOLSADO");
  });

  it("C2 (Nightingale): cancelar pelo cardápio tem limite por IP (10/min)", async () => {
    const ctx = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await customerCancel(ctx.slug, `inexistente-${i}`)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 404)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it("cupom: devolução uma única vez mesmo com a conclusão do estorno repetida; pedido cancelado antes da migração (marcado tratado) não devolve", async () => {
    const ctx = await setup();
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.cookie }, payload: { code: "DEZ", discountType: "FIXED", discountValue: 100 } });
    const couponId = (await prisma.coupon.findFirst({ where: { storeId: ctx.storeId } }))!.id;

    // Pedido pago com cupom + outro uso do mesmo cupom: usedCount = 2. Devolver em dobro deixaria 0 em vez de 1.
    const id = await paidOrder(ctx, { couponCode: "DEZ" });
    await prisma.coupon.update({ where: { id: couponId }, data: { usedCount: 2 } });
    refundPayment.mockRejectedValueOnce(new Error("timeout"));
    await cancel(ctx.cookie, id, { code: "ITEM_EM_FALTA" });
    await Promise.all([
      app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie: ctx.cookie } }),
      app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie: ctx.cookie } }),
    ]);
    expect((await prisma.order.findUnique({ where: { id } }))?.status).toBe("CANCELADO");
    expect((await prisma.coupon.findUnique({ where: { id: couponId } }))?.usedCount).toBe(1);

    // Simula pedido legado cancelado ANTES da migração: couponReleasedAt já preenchido pelo backfill.
    const legacy = await newOrder(ctx, { couponCode: "DEZ" });
    await prisma.coupon.update({ where: { id: couponId }, data: { usedCount: 5 } });
    await prisma.order.update({ where: { id: legacy }, data: { couponReleasedAt: new Date() } });
    expect((await cancel(ctx.cookie, legacy, { code: "CLIENTE_DESISTIU" })).statusCode).toBe(200);
    expect((await prisma.coupon.findUnique({ where: { id: couponId } }))?.usedCount).toBe(5); // trava já marcada: não devolve de novo
  });

  it("refund/retry: só OWNER, só com estorno pendente (NOT_REFUND_PENDING)", async () => {
    const ctx = await setup();
    const staff = await staffCookie(ctx);
    const id = await newOrder(ctx);
    const retry = (cookie: string) => app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie } });
    expect(json(await retry(ctx.cookie)).code).toBe("NOT_REFUND_PENDING");
    expect(json(await retry(staff)).code).toBe("FORBIDDEN_ROLE");
  });

  // ───────────── Cliente ─────────────
  it("cliente cancela PENDENTE (200, refund NONE); depois de aceito recebe 409 ORDER_ALREADY_ACCEPTED", async () => {
    const ctx = await setup();
    const a = await newOrder(ctx);
    const ok = await customerCancel(ctx.slug, a);
    expect(ok.statusCode).toBe(200);
    expect(json(ok)).toEqual({ status: "CANCELADO", refund: "NONE" });
    expect((await customerCancel(ctx.slug, a)).statusCode).toBe(200); // repetir é idempotente
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: a, kind: "CANCEL" } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ source: "CUSTOMER", reasonCode: "CLIENTE_DESISTIU" });

    const b = await newOrder(ctx);
    await transition(ctx.cookie, b, "CONFIRMADO");
    const late = await customerCancel(ctx.slug, b);
    expect(late.statusCode).toBe(409);
    expect(json(late).code).toBe("ORDER_ALREADY_ACCEPTED");
    expect((await customerCancel(ctx.slug, "nao-existe")).statusCode).toBe(404);
  });

  it("cliente cancela pedido com PIX aprovado: estorno automático (sem MFA/OWNER)", async () => {
    const ctx = await setup();
    const id = await paidOrder(ctx);
    const res = await customerCancel(ctx.slug, id);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ status: "CANCELADO", refund: "DONE" });
    expect(refundPayment).toHaveBeenCalledTimes(1);
    const order = await prisma.order.findUnique({ where: { id }, include: { payment: true } });
    expect({ status: order?.status, payment: order?.payment?.status }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO" });
  });

  it("cliente cancela e o estorno falha: pedido segue PENDENTE com estorno pendente (refund PENDING)", async () => {
    const ctx = await setup();
    const id = await paidOrder(ctx);
    refundPayment.mockRejectedValueOnce(new Error("down"));
    const res = await customerCancel(ctx.slug, id);
    expect(res.statusCode).toBe(200);
    expect(json(res).refund).toBe("PENDING");
    expect((await prisma.order.findUnique({ where: { id } }))?.status).toBe("PENDENTE");
  });

  it("corrida cliente × loja (sem pagamento): em 8 rodadas, sempre um vencedor e o estado final bate com a resposta", async () => {
    const ctx = await setup();
    for (let i = 0; i < 8; i++) {
      const id = await newOrder(ctx);
      const [c, s] = await Promise.all([customerCancel(ctx.slug, id), transition(ctx.cookie, id, "CONFIRMADO")]);
      const final = (await prisma.order.findUnique({ where: { id } }))?.status;
      expect([c.statusCode, s.statusCode].sort(), `rodada ${i}`).toEqual([200, 409]);
      expect(final).toBe(c.statusCode === 200 ? "CANCELADO" : "CONFIRMADO");
    }
  });

  it("corrida cliente × loja COM PIX aprovado: nunca CONFIRMADO+estornado nem CANCELADO sem estorno", async () => {
    const ctx = await setup();
    for (let i = 0; i < 8; i++) {
      refundPayment.mockClear();
      const id = await paidOrder(ctx);
      await Promise.all([customerCancel(ctx.slug, id), transition(ctx.cookie, id, "CONFIRMADO")]);
      const o = await prisma.order.findUnique({ where: { id }, include: { payment: true } });
      const key = `${o?.status}/${o?.payment?.status}`;
      expect(["CANCELADO/REEMBOLSADO", "CONFIRMADO/APROVADO"], `rodada ${i}: ${key}`).toContain(key);
      expect(refundPayment).toHaveBeenCalledTimes(key === "CANCELADO/REEMBOLSADO" ? 1 : 0);
    }
  });

  it("com o estorno do cliente em andamento (determinístico), a loja não consegue aceitar nem desfazer; ao concluir o pedido fica CANCELADO", async () => {
    const ctx = await setup();
    const id = await paidOrder(ctx);
    let release!: () => void;
    refundPayment.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    const pending = customerCancel(ctx.slug, id);
    await vi.waitFor(async () => expect((await prisma.payment.findUnique({ where: { orderId: id } }))?.status).toBe("ESTORNO_PENDENTE"));

    const accept = await transition(ctx.cookie, id, "CONFIRMADO");
    expect(accept.statusCode).toBe(409);
    expect(json(accept).code).toBe("REFUND_PENDING");
    expect((await prisma.order.findUnique({ where: { id } }))?.status).toBe("PENDENTE");

    release();
    const done = await pending;
    expect(json(done)).toEqual({ status: "CANCELADO", refund: "DONE" });
    const order = await prisma.order.findUnique({ where: { id }, include: { payment: true } });
    expect({ status: order?.status, payment: order?.payment?.status }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO" });
  });

  it("loja aceitou ANTES do cliente iniciar o estorno (determinístico): cliente recebe 409 e o dinheiro não é tocado", async () => {
    const ctx = await setup();
    const id = await paidOrder(ctx);
    await transition(ctx.cookie, id, "CONFIRMADO");
    const res = await customerCancel(ctx.slug, id);
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe("ORDER_ALREADY_ACCEPTED");
    expect(refundPayment).not.toHaveBeenCalled();
    expect((await prisma.payment.findUnique({ where: { orderId: id } }))?.status).toBe("APROVADO");
  });

  it("payment-status do checkout indica terminal e o motivo quando o pedido foi cancelado", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    const before = json(await app.inject({ method: "GET", url: `/stores/${ctx.slug}/orders/${id}/payment-status` }));
    expect(before).toMatchObject({ orderStatus: "PENDENTE", terminal: false, cancelReason: null });
    await cancel(ctx.cookie, id, { code: "ITEM_EM_FALTA", customerMessage: "Item indisponível" });
    const after = json(await app.inject({ method: "GET", url: `/stores/${ctx.slug}/orders/${id}/payment-status` }));
    expect(after).toMatchObject({ orderStatus: "CANCELADO", terminal: true, cancelReason: { customerMessage: "Item indisponível" } });
  });

  // ───────────── Desfazer ─────────────
  it("desfazer volta um passo, só uma vez, e some depois do prazo para STAFF (OWNER sempre pode)", async () => {
    const ctx = await setup();
    const staff = await staffCookie(ctx);
    const id = await newOrder(ctx);
    expect(json(await undo(staff, id)).code).toBe("NOTHING_TO_UNDO"); // nada além da criação

    await transition(staff, id, "CONFIRMADO");
    const listed = json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: staff } })).orders[0];
    expect(listed.canUndo).toBe(true);
    expect(new Date(listed.undoUntil).getTime()).toBeGreaterThan(Date.now());

    const back = await undo(staff, id);
    expect(back.statusCode).toBe(200);
    expect(json(back).order.status).toBe("PENDENTE");
    expect(json(await undo(staff, id)).code).toBe("NOTHING_TO_UNDO"); // não desfaz o desfazer

    await transition(staff, id, "CONFIRMADO");
    await prisma.orderStatusHistory.updateMany({ where: { orderId: id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const expired = await undo(staff, id);
    expect(expired.statusCode).toBe(409);
    expect(json(expired).code).toBe("UNDO_WINDOW_EXPIRED");
    const owner = await undo(ctx.cookie, id);
    expect(owner.statusCode).toBe(200);
    expect(json(owner).order.status).toBe("PENDENTE");
    const kinds = (await prisma.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { seq: "asc" } })).map((h) => h.kind);
    expect(kinds).toEqual(["ADVANCE", "ADVANCE", "UNDO", "ADVANCE", "UNDO"]);
  });

  it("não desfaz pedido concluído", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]) await transition(ctx.cookie, id, to);
    expect(json(await undo(ctx.cookie, id)).code).toBe("INVALID_TRANSITION");
  });

  // ───────────── Rotas legadas ─────────────
  it("legado /status: avança pelo mesmo serviço e recusa cancelar pedido pago sem o fluxo de estorno", async () => {
    const ctx = await setup();
    const id = await newOrder(ctx);
    const ok = await app.inject({ method: "POST", url: `/api/orders/${id}/status`, headers: { cookie: ctx.cookie }, payload: { status: "CONFIRMADO" } });
    expect(ok.statusCode).toBe(200);
    expect(json(ok)).toEqual({ ok: true });
    const bad = await app.inject({ method: "POST", url: `/api/orders/${id}/status`, headers: { cookie: ctx.cookie }, payload: { status: "CONCLUIDO" } });
    expect(bad.statusCode).toBe(409);

    const paid = await paidOrder(ctx);
    const refused = await app.inject({ method: "POST", url: `/api/orders/${paid}/status`, headers: { cookie: ctx.cookie }, payload: { status: "CANCELADO" } });
    expect(refused.statusCode).toBe(409);
    expect(json(refused).code).toBe("REFUND_REQUIRED");
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("legado /refund: estorna pedido pago pelo mesmo serviço; sem pagamento aprovado é 409", async () => {
    const ctx = await setup();
    const free = await newOrder(ctx);
    const none = await app.inject({ method: "POST", url: `/api/orders/${free}/refund`, headers: { cookie: ctx.cookie } });
    expect(none.statusCode).toBe(409);
    const paid = await paidOrder(ctx);
    const done = await app.inject({ method: "POST", url: `/api/orders/${paid}/refund`, headers: { cookie: ctx.cookie } });
    expect(done.statusCode).toBe(200);
    expect((await prisma.order.findUnique({ where: { id: paid } }))?.status).toBe("CANCELADO");
  });
});
