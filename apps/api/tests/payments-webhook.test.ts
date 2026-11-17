// API-03 — webhook idempotente, estados do pagamento, conferência de valor/referência, pago-após-cancelado,
// PIX sem cobrança órfã (ADR-0007 §4, §6). O provedor (Mercado Pago) é SEMPRE simulado.
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { mapMpStatus } from "../src/lib/mercadopago";
import { PAYMENT_STATUSES, canMovePayment, isFinalPayment, originsFor } from "../src/lib/paymentStateMachine";
import { subscribe } from "../src/realtime/hub";
import { makeApp, registerStore, resetDb, orderTokenHeader } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
const createPix = vi.mocked(mp.createPixPayment);
const getPayment = vi.mocked(mp.getPayment);
const cancelPayment = vi.mocked(mp.cancelPayment);
const refundPayment = vi.mocked(mp.refundPayment);

// ───────────── Unitários puros ─────────────
describe("mapMpStatus (ADR-0007 §4)", () => {
  it.each([
    ["pending", "PENDENTE"],
    ["in_process", "EM_ANALISE"],
    ["authorized", "EM_ANALISE"],
    ["in_mediation", "EM_ANALISE"],
    ["approved", "APROVADO"],
    ["rejected", "REJEITADO"],
    ["cancelled", "CANCELADO"],
    ["expired", "EXPIRADO"],
    ["refunded", "REEMBOLSADO"],
    ["charged_back", "CONTESTADO"],
  ])("%s → %s", (remote, internal) => {
    expect(mapMpStatus(remote)).toBe(internal);
  });
  it("status desconhecido, vazio ou ausente NÃO vira PENDENTE: devolve null", () => {
    for (const unknown of ["algo_novo", "", undefined, null]) expect(mapMpStatus(unknown as never)).toBeNull();
  });
});

describe("máquina de estados do pagamento", () => {
  it("arestas permitidas (e só elas); estados finais não saem, exceto aprovação tardia de cobrança cancelada/expirada", () => {
    const allowed: Record<string, string[]> = {
      PENDENTE: ["EM_ANALISE", "APROVADO", "REJEITADO", "CANCELADO", "EXPIRADO"],
      EM_ANALISE: ["APROVADO", "REJEITADO", "CANCELADO"],
      APROVADO: ["ESTORNO_PENDENTE", "REEMBOLSADO", "CONTESTADO"],
      ESTORNO_PENDENTE: ["REEMBOLSADO", "CONTESTADO"],
      CANCELADO: ["APROVADO"],
      EXPIRADO: ["APROVADO"],
      REJEITADO: [],
      REEMBOLSADO: [],
      CONTESTADO: [],
    };
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) expect(canMovePayment(from, to), `${from}→${to}`).toBe(allowed[from].includes(to));
    }
    expect(PAYMENT_STATUSES.filter(isFinalPayment).sort()).toEqual(["CONTESTADO", "REEMBOLSADO", "REJEITADO"]);
    expect(originsFor("APROVADO").sort()).toEqual(["CANCELADO", "EM_ANALISE", "EXPIRADO", "PENDENTE"]);
    expect(originsFor("PENDENTE")).toEqual([]);
  });
});

// ───────────── Integração ─────────────
describe("API-03 — webhook e PIX", () => {
  let app: ReturnType<typeof makeApp>;
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
  let seq = 0;

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(
      await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } }),
    ).product.id as string;
    return { cookie: cookie!, storeId: storeId as string, slug: slug as string, productId };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  // Pedido PIX pelo caminho real do cardápio (Tx1 cria pedido + pagamento; depois o provedor).
  async function pixOrder(ctx: Ctx, extra: Record<string, unknown> = {}) {
    seq += 1;
    const providerPaymentId = `mp-${Date.now()}-${seq}`;
    createPix.mockResolvedValueOnce({ providerPaymentId, status: "pending", pixQrCode: "0002", pixQrCodeBase64: "AA", expiresAt: new Date(Date.now() + 1_800_000) });
    const res = await app.inject({
      method: "POST",
      url: `/stores/${ctx.slug}/orders`,
      payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], paymentMethod: "PIX", ...extra },
    });
    expect(res.statusCode).toBe(201);
    return { orderId: json(res).orderId as string, providerPaymentId };
  }

  // Visão do provedor: por padrão confere com o que gravamos; `over` força divergências.
  async function remote(providerPaymentId: string, status: string, over: Record<string, unknown> = {}) {
    const p = await prisma.payment.findUnique({ where: { providerPaymentId } });
    return { providerPaymentId, status, externalReference: p?.orderId ?? null, amountCents: p?.amountCents ?? null, currency: "BRL", ...over };
  }
  async function provider(providerPaymentId: string, status: string, over: Record<string, unknown> = {}) {
    getPayment.mockResolvedValue((await remote(providerPaymentId, status, over)) as never);
  }

  function sign(dataId: string, ts: string, secret = "test-webhook-secret") {
    const requestId = `req-${Math.random().toString(36).slice(2)}`;
    const v1 = createHmac("sha256", secret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
    return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
  }
  const webhook = (dataId: string, ts: string = String(Date.now())) =>
    app.inject({ method: "POST", url: "/api/payments/webhook", headers: sign(dataId, ts), payload: { type: "payment", data: { id: dataId } } });

  const orderOf = (id: string) => prisma.order.findUnique({ where: { id }, include: { payment: true } });
  const wsSocket = (storeId: string) => {
    const sent: string[] = [];
    subscribe(storeId, { readyState: 1, OPEN: 1, send: (m: string) => sent.push(m), on: vi.fn() } as never);
    return { count: (type: string) => sent.filter((m) => m.includes(type)).length };
  };

  // ───────────── Aprovação e idempotência ─────────────
  it("aprovado: libera o pedido e anuncia UMA vez, mesmo com 5 entregas seguidas e 5 simultâneas", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    const ws = wsSocket(ctx.storeId);
    await provider(providerPaymentId, "approved");
    for (let i = 0; i < 5; i++) expect((await webhook(providerPaymentId)).statusCode).toBe(200);
    await Promise.all(Array.from({ length: 5 }, () => webhook(providerPaymentId)));
    const o = await orderOf(orderId);
    expect({ awaiting: o?.awaitingPayment, status: o?.status, payment: o?.payment?.status }).toEqual({ awaiting: false, status: "PENDENTE", payment: "APROVADO" });
    expect(ws.count("order.created")).toBe(1);
  });

  it("não aprova quando valor, moeda ou referência do provedor divergem do que gravamos (nem quando faltam)", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    const ws = wsSocket(ctx.storeId);
    const cases: Record<string, unknown>[] = [
      { amountCents: 1 },
      { amountCents: 10_000_000 },
      { externalReference: "outro-pedido" },
      { currency: "USD" },
      { amountCents: null },
      { externalReference: null },
      { currency: null },
    ];
    for (const over of cases) {
      await provider(providerPaymentId, "approved", over);
      expect((await webhook(providerPaymentId)).statusCode).toBe(200); // ignorado conscientemente, não é erro do provedor
      const o = await orderOf(orderId);
      expect({ awaiting: o?.awaitingPayment, payment: o?.payment?.status }, JSON.stringify(over)).toEqual({ awaiting: true, payment: "PENDENTE" });
    }
    expect(ws.count("order.created")).toBe(0);
    expect((await prisma.payment.findUnique({ where: { providerPaymentId } }))?.lastRawStatus).toBe("approved");
  });

  it("status desconhecido do provedor não muda nada (nem vira PENDENTE) e fica registrado", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    await provider(providerPaymentId, "approved");
    await webhook(providerPaymentId);
    await provider(providerPaymentId, "status_novo_do_mp");
    expect((await webhook(providerPaymentId)).statusCode).toBe(200);
    const o = await orderOf(orderId);
    expect(o?.payment).toMatchObject({ status: "APROVADO", lastRawStatus: "status_novo_do_mp" });
  });

  // ───────────── Só avança ─────────────
  it("nunca regride: APROVADO não volta a PENDENTE/EM_ANALISE, REEMBOLSADO não volta a APROVADO, CONTESTADO é final", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    await provider(providerPaymentId, "approved");
    await webhook(providerPaymentId);
    for (const stale of ["pending", "in_process"]) {
      await provider(providerPaymentId, stale);
      await webhook(providerPaymentId);
      expect((await orderOf(orderId))?.payment?.status, stale).toBe("APROVADO");
    }
    await provider(providerPaymentId, "charged_back");
    await webhook(providerPaymentId);
    expect((await orderOf(orderId))?.payment?.status).toBe("CONTESTADO");
    await provider(providerPaymentId, "approved");
    await webhook(providerPaymentId);
    expect((await orderOf(orderId))?.payment?.status).toBe("CONTESTADO");
  });

  it("in_process vira EM_ANALISE e depois aprova normalmente", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    const ws = wsSocket(ctx.storeId);
    await provider(providerPaymentId, "in_process");
    await webhook(providerPaymentId);
    expect((await orderOf(orderId))?.payment?.status).toBe("EM_ANALISE");
    expect((await orderOf(orderId))?.awaitingPayment).toBe(true);
    await provider(providerPaymentId, "approved");
    await webhook(providerPaymentId);
    expect((await orderOf(orderId))?.payment?.status).toBe("APROVADO");
    expect(ws.count("order.created")).toBe(1);
  });

  // ───────────── Pagamento não aprovado ─────────────
  it.each(["rejected", "expired", "cancelled"])("%s: cancela o pedido com motivo de sistema, devolve o cupom e não estorna; entrega repetida não duplica", async (remoteStatus) => {
    const ctx = await setup();
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.cookie }, payload: { code: "PIX10", discountType: "FIXED", discountValue: 100 } });
    const { orderId, providerPaymentId } = await pixOrder(ctx, { couponCode: "PIX10" });
    expect((await prisma.coupon.findFirst({ where: { storeId: ctx.storeId } }))?.usedCount).toBe(1);
    await provider(providerPaymentId, remoteStatus);
    await Promise.all([webhook(providerPaymentId), webhook(providerPaymentId)]);
    await webhook(providerPaymentId);
    const o = await orderOf(orderId);
    expect(o?.status).toBe("CANCELADO");
    expect(await prisma.orderStatusHistory.findMany({ where: { orderId, kind: "CANCEL" } })).toMatchObject([
      { reasonCode: "PAGAMENTO_NAO_APROVADO", source: "WEBHOOK", userId: null, customerMessage: "O pagamento não foi aprovado e o pedido foi cancelado." },
    ]);
    expect((await prisma.coupon.findFirst({ where: { storeId: ctx.storeId } }))?.usedCount).toBe(0);
    expect(refundPayment).not.toHaveBeenCalled();
    expect(cancelPayment).not.toHaveBeenCalled(); // o provedor já disse que não está ativo
  });

  // ───────────── Pago depois de cancelado (B02 / RN-B3-04) ─────────────
  it.each([
    ["cobrança ainda PENDENTE para nós (cancelar no provedor falhou)", true],
    ["cobrança já CANCELADA para nós (aprovação tardia)", false],
  ])("aprovado DEPOIS do cancelamento — %s: estorna, NÃO anuncia e o pedido continua cancelado", async (_label, cancelAtProviderFails) => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    const ws = wsSocket(ctx.storeId);
    if (cancelAtProviderFails) cancelPayment.mockRejectedValueOnce(new Error("MP: já pago"));
    expect((await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders/${orderId}/cancel`, headers: orderTokenHeader(orderId) })).statusCode).toBe(200);
    expect((await orderOf(orderId))?.payment?.status).toBe(cancelAtProviderFails ? "PENDENTE" : "CANCELADO");

    await provider(providerPaymentId, "approved");
    await Promise.all([webhook(providerPaymentId), webhook(providerPaymentId), webhook(providerPaymentId)]);
    const o = await orderOf(orderId);
    expect({ status: o?.status, payment: o?.payment?.status }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO" });
    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(refundPayment).toHaveBeenCalledWith(providerPaymentId, `refund-${o!.payment!.id}`);
    expect(ws.count("order.created")).toBe(0);
    expect(await prisma.orderStatusHistory.count({ where: { orderId, kind: "CANCEL" } })).toBe(1); // sem segundo cancelamento
  });

  it("aprovado depois de cancelado e o estorno falha: fica ESTORNO_PENDENTE com o pedido cancelado; a nova tentativa conclui sem novo cancelamento", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders/${orderId}/cancel`, headers: orderTokenHeader(orderId) });
    await provider(providerPaymentId, "approved");
    refundPayment.mockRejectedValueOnce(new Error("timeout"));
    expect((await webhook(providerPaymentId)).statusCode).toBe(200);
    let o = await orderOf(orderId);
    expect({ status: o?.status, payment: o?.payment?.status, attempts: o?.payment?.refundAttempts }).toEqual({ status: "CANCELADO", payment: "ESTORNO_PENDENTE", attempts: 1 });

    const retry = await app.inject({ method: "POST", url: `/api/orders/${orderId}/refund/retry`, headers: { cookie: ctx.cookie } });
    expect(retry.statusCode).toBe(200);
    o = await orderOf(orderId);
    expect({ status: o?.status, payment: o?.payment?.status }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO" });
    expect(await prisma.orderStatusHistory.count({ where: { orderId, kind: "CANCEL" } })).toBe(1);
  });

  // ───────────── Estorno por fora / durante a saga ─────────────
  it("estorno feito no painel do provedor (APROVADO → refunded): pedido cancelado, sem novo estorno e sem regredir", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    await provider(providerPaymentId, "approved");
    await webhook(providerPaymentId);
    await provider(providerPaymentId, "refunded");
    await Promise.all([webhook(providerPaymentId), webhook(providerPaymentId)]);
    const o = await orderOf(orderId);
    expect({ status: o?.status, payment: o?.payment?.status }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO" });
    expect(refundPayment).not.toHaveBeenCalled();
    expect(await prisma.orderStatusHistory.findMany({ where: { orderId, kind: "CANCEL" } })).toMatchObject([{ reasonCode: "PAGAMENTO_ESTORNADO_NO_PROVEDOR", source: "WEBHOOK" }]);
    await provider(providerPaymentId, "approved"); // notificação velha chegando depois
    await webhook(providerPaymentId);
    expect((await orderOf(orderId))?.payment?.status).toBe("REEMBOLSADO");
  });

  it("durante a nossa saga de estorno o provedor já mostra 'refunded': a saga conclui e cancela o pedido (não fica ativo com o dinheiro devolvido)", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    await provider(providerPaymentId, "approved");
    await webhook(providerPaymentId);
    refundPayment.mockRejectedValueOnce(new Error("timeout depois do aceite"));
    const cancel = await app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`, headers: { cookie: ctx.cookie }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect(cancel.statusCode).toBe(202);
    expect((await orderOf(orderId))?.payment?.status).toBe("ESTORNO_PENDENTE");

    refundPayment.mockRejectedValueOnce(new Error("already refunded"));
    await provider(providerPaymentId, "refunded");
    expect((await webhook(providerPaymentId)).statusCode).toBe(200);
    const o = await orderOf(orderId);
    expect({ status: o?.status, payment: o?.payment?.status }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO" });
    expect(await prisma.orderStatusHistory.count({ where: { orderId, kind: "CANCEL" } })).toBe(1);
  });

  // ───────────── A3-C1 (Nightingale): dinheiro saiu por fora com o pedido já finalizado ─────────────
  async function pedidoConcluidoPago(ctx: Ctx) {
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    await provider(providerPaymentId, "approved");
    await webhook(providerPaymentId);
    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]) {
      const r = await app.inject({ method: "POST", url: `/api/orders/${orderId}/transition`, headers: { cookie: ctx.cookie }, payload: { to } });
      expect(r.statusCode, to).toBe(200);
    }
    return { orderId, providerPaymentId };
  }
  const auditCount = (storeId: string, action: string) => prisma.auditLog.count({ where: { storeId, action } });

  it.each([
    ["refunded", "REEMBOLSADO", "estornado fora do sistema"],
    ["charged_back", "CONTESTADO", "Contestação"],
  ])("A3-C1: %s com o pedido já CONCLUIDO ⇒ conciliação visível (nota, alerta e auditoria), uma única vez", async (remoteStatus, internal, noteHint) => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pedidoConcluidoPago(ctx);
    const ws = wsSocket(ctx.storeId);
    await provider(providerPaymentId, remoteStatus);
    await Promise.all([webhook(providerPaymentId), webhook(providerPaymentId)]);
    await webhook(providerPaymentId);
    const o = await orderOf(orderId);
    expect({ status: o?.status, payment: o?.payment?.status }).toEqual({ status: "CONCLUIDO", payment: internal });
    expect(o?.payment?.reconcileNote).toContain(noteHint);
    expect(ws.count("payment.reconcile_needed")).toBe(1);
    await vi.waitFor(async () => expect(await auditCount(ctx.storeId, "order.refund_reconcile")).toBe(1), { timeout: 10_000, interval: 50 });
    const listed = json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: ctx.cookie } })).orders.find((x: { id: string }) => x.id === orderId);
    expect(listed.payment.reconcileRequired).toBe(true);
  }, 60_000); // pedido + webhook + 4 transições: sob carga passava de 15 s; o que o teste afirma não mudou

  it("A3-C1: estorno por fora de pedido ATIVO cancela o pedido e NÃO é conciliação; chargeback de pedido ativo é conciliação", async () => {
    const ctx = await setup();
    const a = await pixOrder(ctx);
    await provider(a.providerPaymentId, "approved");
    await webhook(a.providerPaymentId);
    await provider(a.providerPaymentId, "refunded");
    await webhook(a.providerPaymentId);
    const oa = await orderOf(a.orderId);
    expect({ status: oa?.status, payment: oa?.payment?.status, note: oa?.payment?.reconcileNote }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO", note: null });
    // Condições do Leonardo (CA-MC-15): frase aprovada ao cliente e linha de dinheiro sempre a de "estornado" (caso B).
    const publico = json(await app.inject({ method: "GET", url: `/stores/${ctx.slug}/orders/${a.orderId}/payment-status`, headers: orderTokenHeader(a.orderId) }));
    expect(publico.cancelReason).toEqual({
      customerMessage: "O pagamento foi estornado e o pedido foi cancelado.",
      moneyLine: "O valor de R$ 10,00 foi estornado. O prazo para aparecer depende do seu banco.",
    });
    const painel = json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: ctx.cookie } })).orders.find((x: { id: string }) => x.id === a.orderId);
    expect(painel.cancel).toMatchObject({ reasonCode: "PAGAMENTO_ESTORNADO_NO_PROVEDOR", by: "SYSTEM", customerMessage: "O pagamento foi estornado e o pedido foi cancelado." });

    const b = await pixOrder(ctx);
    await provider(b.providerPaymentId, "approved");
    await webhook(b.providerPaymentId);
    await provider(b.providerPaymentId, "charged_back");
    await webhook(b.providerPaymentId);
    const ob = await orderOf(b.orderId);
    expect(ob?.payment).toMatchObject({ status: "CONTESTADO" });
    // Chargeback NÃO cancela o pedido (ADR-0007 §6.1): só conciliação e alerta; o pedido segue ativo e sem motivo de cancelamento.
    expect(ob?.status).toBe("PENDENTE");
    expect(await prisma.orderStatusHistory.count({ where: { orderId: b.orderId, kind: "CANCEL" } })).toBe(0);
    const pubB = json(await app.inject({ method: "GET", url: `/stores/${ctx.slug}/orders/${b.orderId}/payment-status`, headers: orderTokenHeader(b.orderId) }));
    expect(pubB.cancelReason).toBeNull();
    expect(ob?.payment?.reconcileNote).toContain("Contestação");
  }, 60_000);

  it("R3: MP_WEBHOOK_TS_TOLERANCE_SEC tem teto de 3600 s", async () => {
    const ctx = await setup();
    const { providerPaymentId } = await pixOrder(ctx);
    await provider(providerPaymentId, "approved");
    process.env.MP_WEBHOOK_TS_TOLERANCE_SEC = "999999";
    try {
      expect((await webhook(providerPaymentId, String(Date.now() - 2 * 3600_000))).statusCode).toBe(401); // 2 h > teto de 1 h
      expect((await webhook(providerPaymentId, String(Date.now() - 1800_000))).statusCode).toBe(200); // 30 min dentro do teto
    } finally {
      delete process.env.MP_WEBHOOK_TS_TOLERANCE_SEC;
    }
  });

  // ───────────── Cobrança órfã (SEC-17 / B16) ─────────────
  it("o pagamento nasce com a chave de idempotência ANTES de falar com o provedor, e a mesma chave vai para ele", async () => {
    const ctx = await setup();
    let seenBefore: { idempotencyKey: string | null; providerPaymentId: string | null; status: string } | null = null;
    createPix.mockImplementationOnce(async (input) => {
      const row = await prisma.payment.findFirst({ where: { orderId: input.orderId } });
      seenBefore = row && { idempotencyKey: row.idempotencyKey, providerPaymentId: row.providerPaymentId, status: row.status };
      return { providerPaymentId: "mp-ordem", status: "pending", pixQrCode: "x", pixQrCodeBase64: "y", expiresAt: new Date(Date.now() + 60_000) };
    });
    const res = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], paymentMethod: "PIX" } });
    expect(res.statusCode).toBe(201);
    expect(seenBefore).toMatchObject({ providerPaymentId: null, status: "PENDENTE" });
    expect(seenBefore!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(createPix.mock.calls[0][0].idempotencyKey).toBe(seenBefore!.idempotencyKey);
    expect((await prisma.payment.findFirst({ where: { orderId: json(res).orderId } }))?.providerPaymentId).toBe("mp-ordem");
  });

  it("falha ao criar o PIX: pedido NÃO é apagado (cancelado com motivo), cobrança local fechada, cupom devolvido, 502", async () => {
    const ctx = await setup();
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.cookie }, payload: { code: "PIX10", discountType: "FIXED", discountValue: 100 } });
    createPix.mockRejectedValueOnce(new Error("MP indisponível"));
    const res = await app.inject({
      method: "POST",
      url: `/stores/${ctx.slug}/orders`,
      payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], paymentMethod: "PIX", couponCode: "PIX10" },
    });
    expect(res.statusCode).toBe(502);
    const orders = await prisma.order.findMany({ where: { storeId: ctx.storeId }, include: { payment: true } });
    expect(orders).toHaveLength(1);
    expect({ status: orders[0].status, payment: orders[0].payment?.status }).toEqual({ status: "CANCELADO", payment: "CANCELADO" });
    expect((await prisma.coupon.findFirst({ where: { storeId: ctx.storeId } }))?.usedCount).toBe(0);
    // O próximo pedido segue normalmente (número não reaproveita o do cancelado).
    createPix.mockResolvedValueOnce({ providerPaymentId: "mp-2", status: "pending", pixQrCode: "x", pixQrCodeBase64: "y", expiresAt: new Date(Date.now() + 60_000) });
    const next = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], paymentMethod: "PIX" } });
    expect(json(next).code).toBe("0002");
  });

  it("notificação chega ANTES de gravarmos o id do provedor (ou a gravação caiu): a referência externa liga o pagamento e ele é aprovado", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    await prisma.payment.updateMany({ where: { orderId }, data: { providerPaymentId: null } }); // simula a queda antes de gravar
    const ws = wsSocket(ctx.storeId);
    getPayment.mockResolvedValue({ providerPaymentId, status: "approved", externalReference: orderId, amountCents: 1000, currency: "BRL" } as never);
    expect((await webhook(providerPaymentId)).statusCode).toBe(200);
    const o = await orderOf(orderId);
    expect({ provider: o?.payment?.providerPaymentId, payment: o?.payment?.status, awaiting: o?.awaitingPayment }).toEqual({ provider: providerPaymentId, payment: "APROVADO", awaiting: false });
    expect(ws.count("order.created")).toBe(1);
  });

  it("referência existe mas o valor diverge: NÃO liga o pagamento nem aprova", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    await prisma.payment.updateMany({ where: { orderId }, data: { providerPaymentId: null } });
    getPayment.mockResolvedValue({ providerPaymentId, status: "approved", externalReference: orderId, amountCents: 1, currency: "BRL" } as never);
    await webhook(providerPaymentId);
    const o = await orderOf(orderId);
    expect({ provider: o?.payment?.providerPaymentId, awaiting: o?.awaitingPayment }).toEqual({ provider: null, awaiting: true });
  });

  it("pagamento que não é nosso: 200 e nada muda", async () => {
    getPayment.mockResolvedValue({ providerPaymentId: "estranho", status: "approved", externalReference: "x", amountCents: 100, currency: "BRL" } as never);
    expect((await webhook("estranho")).statusCode).toBe(200);
  });

  // ───────────── Assinatura e falhas do provedor ─────────────
  it("assinatura: ts de 2 dias atrás é recusado (replay), ts em segundos e dentro da janela vale, futuro distante é recusado", async () => {
    const ctx = await setup();
    const { providerPaymentId } = await pixOrder(ctx);
    await provider(providerPaymentId, "approved");
    const now = Date.now();
    expect((await webhook(providerPaymentId, String(now - 2 * 86_400_000))).statusCode).toBe(401);
    expect((await webhook(providerPaymentId, String(now + 2 * 86_400_000))).statusCode).toBe(401);
    expect((await webhook(providerPaymentId, String(now - 120_000))).statusCode).toBe(200);
    expect((await webhook(providerPaymentId, String(Math.floor(now / 1000)))).statusCode).toBe(200); // ts em segundos
    expect((await webhook(providerPaymentId, "abc")).statusCode).toBe(401);
  });

  it("assinatura inválida ou segredo errado: 401 e nem consulta o provedor", async () => {
    const ctx = await setup();
    const { providerPaymentId } = await pixOrder(ctx);
    const forged = await app.inject({
      method: "POST",
      url: "/api/payments/webhook",
      headers: sign(providerPaymentId, String(Date.now()), "segredo-errado"),
      payload: { type: "payment", data: { id: providerPaymentId } },
    });
    expect(forged.statusCode).toBe(401);
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("provedor fora do ar na consulta: 503 (o provedor reenvia) e nada muda; a reentrega depois funciona", async () => {
    const ctx = await setup();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    getPayment.mockRejectedValueOnce(new Error("MP 500"));
    expect((await webhook(providerPaymentId)).statusCode).toBe(503);
    expect((await orderOf(orderId))?.payment?.status).toBe("PENDENTE");
    await provider(providerPaymentId, "approved");
    expect((await webhook(providerPaymentId)).statusCode).toBe(200);
    expect((await orderOf(orderId))?.payment?.status).toBe("APROVADO");
  });

  // ───────────── Assinatura da plataforma (SEC-12 d) ─────────────
  async function subscriptionCheckout(ctx: Ctx) {
    seq += 1;
    const providerPaymentId = `mp-sub-${Date.now()}-${seq}`;
    createPix.mockResolvedValueOnce({ providerPaymentId, status: "pending", pixQrCode: "x", pixQrCodeBase64: "y", expiresAt: new Date(Date.now() + 60_000) });
    const res = await app.inject({ method: "POST", url: "/api/store/subscription/checkout", headers: { cookie: ctx.cookie }, payload: { planCode: "PRO" } });
    expect(res.statusCode).toBe(201);
    const sp = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { providerPaymentId } });
    return { providerPaymentId, sp };
  }
  const subRemote = (providerPaymentId: string, sp: { id: string; amountCents: number }, status: string, over: Record<string, unknown> = {}) =>
    getPayment.mockResolvedValue({ providerPaymentId, status, externalReference: sp.id, amountCents: sp.amountCents, currency: "BRL", ...over } as never);

  it("assinatura: webhooks aprovados simultâneos e repetidos ativam o plano UMA vez (30 dias, não 60/90)", async () => {
    const ctx = await setup();
    const { providerPaymentId, sp } = await subscriptionCheckout(ctx);
    subRemote(providerPaymentId, sp, "approved");
    await Promise.all(Array.from({ length: 6 }, () => webhook(providerPaymentId)));
    await webhook(providerPaymentId);
    const sub = await prisma.subscription.findUnique({ where: { storeId: ctx.storeId } });
    const days = (sub!.currentPeriodEnd!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.5);
    expect(days).toBeLessThanOrEqual(30.01);
    expect(sub?.status).toBe("ACTIVE");
  });

  it("R6: dois pagamentos DISTINTOS da mesma assinatura aprovados em paralelo somam os períodos (60 dias), sem perder um", async () => {
    const ctx = await setup();
    const a = await subscriptionCheckout(ctx);
    const b = await subscriptionCheckout(ctx);
    getPayment.mockImplementation((async (id: string) => {
      const sp = id === a.providerPaymentId ? a.sp : b.sp;
      return { providerPaymentId: id, status: "approved", externalReference: sp.id, amountCents: sp.amountCents, currency: "BRL" };
    }) as never);
    await Promise.all([webhook(a.providerPaymentId), webhook(b.providerPaymentId)]);
    const sub = await prisma.subscription.findUnique({ where: { storeId: ctx.storeId } });
    const days = (sub!.currentPeriodEnd!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59.5);
    expect(days).toBeLessThanOrEqual(60.01);
  });

  it("assinatura: valor/referência divergentes não ativam; 'refunded' depois de aprovado não regride o estado", async () => {
    const ctx = await setup();
    const { providerPaymentId, sp } = await subscriptionCheckout(ctx);
    subRemote(providerPaymentId, sp, "approved", { amountCents: 100 });
    await webhook(providerPaymentId);
    expect((await prisma.subscription.findUnique({ where: { storeId: ctx.storeId } }))?.status).not.toBe("ACTIVE");
    subRemote(providerPaymentId, sp, "approved", { externalReference: "outro" });
    await webhook(providerPaymentId);
    expect((await prisma.subscription.findUnique({ where: { storeId: ctx.storeId } }))?.status).not.toBe("ACTIVE");

    subRemote(providerPaymentId, sp, "approved");
    await webhook(providerPaymentId);
    expect((await prisma.subscription.findUnique({ where: { storeId: ctx.storeId } }))?.status).toBe("ACTIVE");
    subRemote(providerPaymentId, sp, "pending");
    await webhook(providerPaymentId);
    expect((await prisma.subscriptionPayment.findUnique({ where: { providerPaymentId } }))?.status).toBe("APROVADO");
    subRemote(providerPaymentId, sp, "refunded");
    await webhook(providerPaymentId);
    expect((await prisma.subscriptionPayment.findUnique({ where: { providerPaymentId } }))?.status).toBe("REEMBOLSADO");
    const days = ((await prisma.subscription.findUnique({ where: { storeId: ctx.storeId } }))!.currentPeriodEnd!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(30.01); // o reembolso não renova nem estende nada
  });
});
