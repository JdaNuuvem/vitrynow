// Testes-sonda do QA (Deming). Cada teste afirma o comportamento CORRETO esperado.
// Teste vermelho = bug confirmado (ID Dxx referenciado em diagnostico-qualidade.md).
// Mercado Pago é SEMPRE mockado — nenhuma chamada de rede real.
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";
import { subscribe } from "../../src/realtime/hub";
import { mapMpStatus } from "../../src/lib/mercadopago";
import { activateSubscription } from "../../src/lib/subscription";

vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return {
    ...original,
    createPixPayment: vi.fn(),
    getPayment: vi.fn(),
    cancelPayment: vi.fn(),
    refundPayment: vi.fn(),
  };
});
import * as mp from "../../src/lib/mercadopago";

const createPix = vi.mocked(mp.createPixPayment);
const getPayment = vi.mocked(mp.getPayment);
const cancelPayment = vi.mocked(mp.cancelPayment);
const refundPayment = vi.mocked(mp.refundPayment);

let pixSeq = 0;
function fakePix() {
  pixSeq += 1;
  return {
    providerPaymentId: `mp-${Date.now()}-${pixSeq}`,
    status: "pending",
    pixQrCode: "000201...",
    pixQrCodeBase64: "AAAA",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  };
}

function signedWebhook(dataId: string) {
  const ts = String(Date.now());
  const requestId = `req-${Math.random().toString(36).slice(2)}`;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", "test-webhook-secret").update(manifest).digest("hex");
  return {
    headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    payload: { type: "payment", data: { id: dataId } },
  };
}

// Convenções (QA/Deming):
//  - bug(...)      = bug CONFIRMADO e determinístico. Usa it.fails: a suíte fica verde enquanto o bug existe e
//                    fica VERMELHA quando alguém o corrigir. Nesse momento troque 'bug' por 'it' (vira regressão).
//  - flakyBug(...) = bug CONFIRMADO mas intermitente (corrida). Fica skip no CI; rode 3x à mão ao corrigir e depois vire 'it'.
const bug = it.fails;
const flakyBug = it.skip;

describe("QA probes — API", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
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

  async function setupStore(overrides: Parameters<typeof registerStore>[1] = {}) {
    const { cookie, response } = await registerStore(app, overrides);
    const storeId = JSON.parse(response.body).store.id as string;
    const slug = JSON.parse(response.body).store.slug as string;
    const category = await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "Lanches" } });
    const categoryId = JSON.parse(category.body).category.id;
    const product = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie: cookie! },
      payload: { categoryId, name: "Combo", priceCents: 1500, additionals: [{ name: "Bacon", priceCents: 300 }] },
    });
    const body = JSON.parse(product.body).product;
    return { cookie: cookie!, storeId, slug, productId: body.id as string, additionalId: body.additionals?.[0]?.id as string | undefined };
  }

  const order = (slug: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload });

  async function pixOrder(ctx: { slug: string; productId: string }, extra: Record<string, unknown> = {}) {
    const pix = fakePix();
    createPix.mockResolvedValueOnce(pix);
    const res = await order(ctx.slug, { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], paymentMethod: "PIX", ...extra });
    expect(res.statusCode).toBe(201);
    return { orderId: JSON.parse(res.body).orderId as string, providerPaymentId: pix.providerPaymentId };
  }

  const webhook = (dataId: string) => {
    const { headers, payload } = signedWebhook(dataId);
    return app.inject({ method: "POST", url: "/api/payments/webhook", headers, payload });
  };

  // ───────────── Concorrência ─────────────
  flakyBug("D01 cupom com maxUses=1 aceita no máximo 1 de N pedidos paralelos", async () => {
    const ctx = await setupStore();
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.cookie }, payload: { code: "unico", discountType: "FIXED", discountValue: 100, maxUses: 1 } });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => order(ctx.slug, { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], couponCode: "unico" })),
    );
    const ok = results.filter((r) => r.statusCode === 201).length;
    const coupon = await prisma.coupon.findFirst({ where: { storeId: ctx.storeId } });
    expect({ ok, usedCount: coupon?.usedCount }).toEqual({ ok: 1, usedCount: 1 });
  });

  it("D02 pedidos simultâneos recebem códigos únicos e nenhum falha", async () => {
    const ctx = await setupStore();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => order(ctx.slug, { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }] })),
    );
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.every((s) => s === 201), `status recebidos: ${statuses.join(",")}`).toBe(true);
    const codes = results.map((r) => JSON.parse(r.body).code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  // ───────────── Regras do pedido público ─────────────
  bug("D03 produto inativo (pausado) não pode ser pedido", async () => {
    const ctx = await setupStore();
    await prisma.product.update({ where: { id: ctx.productId }, data: { active: false } });
    const res = await order(ctx.slug, { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }] });
    expect(res.statusCode).toBe(400);
  });

  bug("D04a DELIVERY com entrega desabilitada na loja é recusado", async () => {
    const ctx = await setupStore();
    await prisma.store.update({ where: { id: ctx.storeId }, data: { deliveryEnabled: false } });
    const res = await order(ctx.slug, { type: "DELIVERY", address: "Rua A, 1", items: [{ productId: ctx.productId, quantity: 1 }] });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  bug("D04b DELIVERY sem endereço é recusado pelo servidor (hoje só o front valida)", async () => {
    const ctx = await setupStore();
    const res = await order(ctx.slug, { type: "DELIVERY", items: [{ productId: ctx.productId, quantity: 1 }] });
    expect(res.statusCode).toBe(400);
  });

  bug("D04c retirada (BALCAO/MESA) com pickup desabilitado é recusada", async () => {
    const ctx = await setupStore();
    await prisma.store.update({ where: { id: ctx.storeId }, data: { pickupEnabled: false } });
    const res = await order(ctx.slug, { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }] });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("D19 entradas inválidas no pedido sempre dão 4xx (nunca 5xx) e não criam pedido", async () => {
    const ctx = await setupStore();
    const other = await setupStore({ slug: "outra-loja", code: "OUT", email: "outro@teste.com" });
    const item = { productId: ctx.productId, quantity: 1 };
    const bad: Record<string, unknown>[] = [
      { type: "BALCAO", items: [] },
      { type: "BALCAO", items: [{ ...item, quantity: 0 }] },
      { type: "BALCAO", items: [{ ...item, quantity: -3 }] },
      { type: "BALCAO", items: [{ ...item, quantity: 1.5 }] },
      { type: "BALCAO", items: [{ ...item, quantity: 101 }] },
      { type: "BALCAO", items: [{ ...item, quantity: "2" }] },
      { type: "BALCAO", items: [{ productId: "nao-existe", quantity: 1 }] },
      { type: "BALCAO", items: [{ productId: other.productId, quantity: 1 }] }, // produto de OUTRA loja
      { type: "BALCAO", items: [{ ...item, additionalIds: [other.additionalId] }] }, // adicional de outra loja
      { type: "TELEPORTE", items: [item] },
      { type: "BALCAO", items: [item], tipCents: -1 },
      { type: "BALCAO", items: [item], tipCents: 1.5 },
      { type: "BALCAO", items: [item], customerPhone: "<script>" },
      { type: "BALCAO", items: [item], notes: "x".repeat(501) },
      { type: "BALCAO", items: [item], paymentMethod: "BITCOIN" },
      { type: "BALCAO", items: [item], paymentMethod: "PIX", changeForCents: 5000 },
      { type: "BALCAO", items: [item], paymentMethod: "DINHEIRO", changeForCents: 100 },
      { type: "BALCAO", items: [item], couponCode: "NAOEXISTE" },
    ];
    const outcomes: string[] = [];
    for (const payload of bad) {
      const res = await order(ctx.slug, payload);
      if (res.statusCode < 400 || res.statusCode >= 500) outcomes.push(`${res.statusCode} <- ${JSON.stringify(payload).slice(0, 90)}`);
    }
    expect(outcomes).toEqual([]);
    expect(await prisma.order.count({ where: { storeId: ctx.storeId } })).toBe(0);
  });

  it("D19b corpo não-JSON/ausente e slug inexistente não derrubam a API", async () => {
    const r1 = await app.inject({ method: "POST", url: "/stores/nao-existe/orders", payload: { type: "BALCAO", items: [] } });
    expect(r1.statusCode).toBe(404);
    const ctx = await setupStore();
    const r2 = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, headers: { "content-type": "application/json" }, payload: "{quebrado" });
    expect(r2.statusCode).toBe(400);
    const r3 = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders` });
    expect(r3.statusCode).toBeGreaterThanOrEqual(400);
    expect(r3.statusCode).toBeLessThan(500);
  });

  // ───────────── Pagamento / PIX ─────────────
  bug("D08 mapMpStatus não trata refunded/charged_back/in_process como PENDENTE", () => {
    expect(mapMpStatus("refunded")).not.toBe("PENDENTE");
    expect(mapMpStatus("charged_back")).not.toBe("PENDENTE");
  });

  bug("D09 webhook 'refunded' não ressuscita pagamento já REEMBOLSADO para PENDENTE", async () => {
    const ctx = await setupStore();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    await prisma.payment.update({ where: { orderId }, data: { status: "REEMBOLSADO" } });
    getPayment.mockResolvedValue({ providerPaymentId, status: "refunded" });
    const res = await webhook(providerPaymentId);
    expect(res.statusCode).toBe(200);
    const payment = await prisma.payment.findUnique({ where: { orderId } });
    expect(payment?.status).toBe("REEMBOLSADO");
  });

  bug("D10 webhook repetido do mesmo pagamento aprovado publica/imprime UMA vez só", async () => {
    const ctx = await setupStore();
    const { providerPaymentId } = await pixOrder(ctx);
    const socket = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn() };
    subscribe(ctx.storeId, socket as never);
    getPayment.mockResolvedValue({ providerPaymentId, status: "approved" });
    await webhook(providerPaymentId);
    await webhook(providerPaymentId);
    await Promise.all([webhook(providerPaymentId), webhook(providerPaymentId)]);
    const created = socket.send.mock.calls.filter(([m]) => String(m).includes("order.created")).length;
    expect(created).toBe(1);
  });

  bug("D11 PIX rejeitado/expirado devolve o uso do cupom e registra no histórico do pedido", async () => {
    const ctx = await setupStore();
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.cookie }, payload: { code: "pix10", discountType: "FIXED", discountValue: 100, maxUses: 1 } });
    const { orderId, providerPaymentId } = await pixOrder(ctx, { couponCode: "pix10" });
    getPayment.mockResolvedValue({ providerPaymentId, status: "expired" });
    await webhook(providerPaymentId);
    const coupon = await prisma.coupon.findFirst({ where: { storeId: ctx.storeId } });
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId, status: "CANCELADO" } });
    expect({ usedCount: coupon?.usedCount, canceladoNoHistorico: history.length }).toEqual({ usedCount: 0, canceladoNoHistorico: 1 });
  });

  bug("D12 cliente NÃO cancela (sem estorno) um pedido cujo PIX já foi APROVADO", async () => {
    const ctx = await setupStore();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    getPayment.mockResolvedValue({ providerPaymentId, status: "approved" });
    await webhook(providerPaymentId);
    const res = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders/${orderId}/cancel` });
    const after = await prisma.order.findUnique({ where: { id: orderId } });
    // Correto: ou recusa (409) mantendo o pedido, ou cancela E estorna. Cancelar sem estornar = dinheiro retido.
    const ok = res.statusCode === 409 || (after?.status === "CANCELADO" && refundPayment.mock.calls.length === 1);
    expect({ status: res.statusCode, orderStatus: after?.status, refunds: refundPayment.mock.calls.length, ok }).toMatchObject({ ok: true });
  });

  bug("D13 pagamento aprovado DEPOIS de o cliente cancelar não reaparece como pedido novo (e deve gerar estorno)", async () => {
    const ctx = await setupStore();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    const socket = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn() };
    subscribe(ctx.storeId, socket as never);
    await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders/${orderId}/cancel` });
    getPayment.mockResolvedValue({ providerPaymentId, status: "approved" });
    await webhook(providerPaymentId);
    const announced = socket.send.mock.calls.filter(([m]) => String(m).includes("order.created")).length;
    expect({ announced, refunds: refundPayment.mock.calls.length }).toEqual({ announced: 0, refunds: 1 });
  });

  it("D21 webhook com assinatura inválida é 401 e não altera nada", async () => {
    const ctx = await setupStore();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    getPayment.mockResolvedValue({ providerPaymentId, status: "approved" });
    const res = await app.inject({
      method: "POST",
      url: "/api/payments/webhook",
      headers: { "x-signature": "ts=1,v1=abcd", "x-request-id": "x" },
      payload: { type: "payment", data: { id: providerPaymentId } },
    });
    expect(res.statusCode).toBe(401);
    expect((await prisma.order.findUnique({ where: { id: orderId } }))?.awaitingPayment).toBe(true);
  });

  flakyBug("D22 webhook de assinatura em paralelo ativa o plano UMA vez (30 dias, não 60)", async () => {
    const ctx = await setupStore();
    const pix = fakePix();
    createPix.mockResolvedValueOnce(pix);
    const checkout = await app.inject({ method: "POST", url: "/api/store/subscription/checkout", headers: { cookie: ctx.cookie }, payload: { planCode: "PRO" } });
    expect(checkout.statusCode).toBe(201);
    getPayment.mockResolvedValue({ providerPaymentId: pix.providerPaymentId, status: "approved" });
    await Promise.all([webhook(pix.providerPaymentId), webhook(pix.providerPaymentId), webhook(pix.providerPaymentId)]);
    const sub = await prisma.subscription.findUnique({ where: { storeId: ctx.storeId } });
    const days = (sub!.currentPeriodEnd!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(30.5);
  });

  // ───────────── Painel: máquina de estados ─────────────
  bug("D14 pedido CANCELADO não pode voltar a CONCLUIDO/EM_PREPARO pelo painel", async () => {
    const ctx = await setupStore();
    const res0 = await order(ctx.slug, { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }] });
    const orderId = JSON.parse(res0.body).orderId;
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/status`, headers: { cookie: ctx.cookie }, payload: { status: "CANCELADO" } });
    const back = await app.inject({ method: "POST", url: `/api/orders/${orderId}/status`, headers: { cookie: ctx.cookie }, payload: { status: "CONCLUIDO" } });
    expect(back.statusCode).toBeGreaterThanOrEqual(400);
  });

  bug("D14b painel não cancela manualmente pedido PIX já pago sem estornar", async () => {
    const ctx = await setupStore();
    const { orderId, providerPaymentId } = await pixOrder(ctx);
    getPayment.mockResolvedValue({ providerPaymentId, status: "approved" });
    await webhook(providerPaymentId);
    const res = await app.inject({ method: "POST", url: `/api/orders/${orderId}/status`, headers: { cookie: ctx.cookie }, payload: { status: "CANCELADO" } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  // ───────────── Sessão / autenticação ─────────────
  bug("D05 cadastro com e-mail já existente responde 409 (não 500)", async () => {
    await registerStore(app, { email: "dup@teste.com" });
    const second = await registerStore(app, { email: "dup@teste.com" });
    expect(second.response.statusCode).toBe(409);
  });

  it("D06 usuário removido perde o acesso imediatamente (sessão antiga não vale)", async () => {
    const owner = await setupStore();
    // Equipe é recurso do PRO (D2/API-08): o teste vale só o fluxo de sessão, então ativamos o PRO nesta loja.
    await activateSubscription({ subscriptionId: (await prisma.subscription.findFirstOrThrow()).id, planCode: "PRO" });
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner.cookie }, payload: { email: "staff@teste.com", password: "senha123" } });
    expect(invite.statusCode).toBe(201);
    const staffId = JSON.parse(invite.body).user.id;
    const loginRes = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "staff@teste.com", password: "senha123" } });
    const staffCookie = (loginRes.headers["set-cookie"] as string).split(";")[0];
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: staffCookie } })).statusCode).toBe(200);
    const del = await app.inject({ method: "POST", url: `/api/users/${staffId}/delete`, headers: { cookie: owner.cookie } });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: staffCookie } });
    expect(after.statusCode).toBe(401);
  });

  it("D06b sessão antiga é invalidada após troca de senha", async () => {
    const { cookie } = await registerStore(app, { email: "troca@teste.com", password: "senha123" });
    const change = await app.inject({ method: "POST", url: "/auth/change-password", headers: { cookie: cookie! }, payload: { currentPassword: "senha123", newPassword: "novaSenha456" } });
    expect(change.statusCode).toBe(200);
    const stolen = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: cookie! } });
    expect(stolen.statusCode).toBe(401);
  });

  it("D07 o JWT de sessão tem expiração (exp)", async () => {
    const { cookie } = await registerStore(app);
    const payload = JSON.parse(Buffer.from(cookie!.split("=")[1].split(".")[1], "base64url").toString());
    expect(payload.exp).toBeTypeOf("number");
  });

  it("D15 rate-limit de login conta por cliente real (X-Forwarded-For), não pelo IP do proxy", async () => {
    // B04: o proxy (Caddy) é declarado em TRUST_PROXY_CIDR; sem isso X-Forwarded-For é ignorado.
    await registerStore(app, { email: "rl@teste.com" });
    process.env.TRUST_PROXY_CIDR = "127.0.0.1";
    const proxied = makeApp();
    await proxied.ready();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await proxied.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "x-forwarded-for": `203.0.113.${i + 1}` },
        payload: { email: "rl@teste.com", password: "errada" },
      });
      statuses.push(res.statusCode);
    }
    delete process.env.TRUST_PROXY_CIDR;
    await proxied.close();
    // 12 clientes diferentes errando 1 vez cada: nenhum deveria tomar 429.
    expect(statuses.filter((s) => s === 429)).toEqual([]);
  });

  // ───────────── Fluxo de impressão (regressão) ─────────────
  it("D16 fluxo do print-client: pending → printable → printed → fila vazia; cancelado não imprime", async () => {
    const ctx = await setupStore();
    const tokenRes = await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: ctx.cookie }, payload: { label: "balcão" } });
    const token = JSON.parse(tokenRes.body).token.token as string;
    const auth = { authorization: `Bearer ${token}` };
    const a = JSON.parse((await order(ctx.slug, { type: "BALCAO", customerName: "Ana", items: [{ productId: ctx.productId, quantity: 2, additionalIds: [ctx.additionalId] }] })).body);
    const b = JSON.parse((await order(ctx.slug, { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }] })).body);
    await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders/${b.orderId}/cancel` });

    const pending = JSON.parse((await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: auth })).body).orders;
    expect(pending.map((o: { id: string }) => o.id)).toEqual([a.orderId]);
    const printable = JSON.parse((await app.inject({ method: "GET", url: `/api/device/orders/${a.orderId}/printable`, headers: auth })).body).order;
    expect(printable.totalCents).toBe((1500 + 300) * 2);
    expect(printable.items[0].additionals[0].name).toBe("Bacon");
    await app.inject({ method: "POST", url: `/api/device/orders/${a.orderId}/printed`, headers: auth, payload: {} });
    const after = JSON.parse((await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: auth })).body).orders;
    expect(after).toEqual([]);
    // token inválido / revogado
    expect((await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: { authorization: "Bearer lixo" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/device/orders/pending" })).statusCode).toBe(401);
  });

  bug('D18 relatório de UM dia (fuso America/Sao_Paulo) inclui pedido feito às 23:30 daquele dia e exclui o das 21:30 do dia anterior', async () => {
    const ctx = await setupStore();
    const mk = async (iso: string) => {
      const r = JSON.parse((await order(ctx.slug, { type: 'BALCAO', items: [{ productId: ctx.productId, quantity: 1 }] })).body);
      await prisma.order.update({ where: { id: r.orderId }, data: { createdAt: new Date(iso) } });
    };
    await mk('2026-11-10T21:30:00-03:00'); // 10/11 à noite em Brasília (= 00:30Z de 11/11) — NÃO é do dia 11
    await mk('2026-11-11T23:30:00-03:00'); // 11/11 à noite em Brasília (= 02:30Z de 12/11) — é do dia 11
    const res = await app.inject({ method: 'GET', url: '/api/reports/summary?from=2026-11-11&to=2026-11-11', headers: { cookie: ctx.cookie } });
    const r = JSON.parse(res.body);
    expect({ orderCount: r.orderCount, dias: r.byDay.map((d: { date: string }) => d.date) }).toEqual({ orderCount: 1, dias: ['2026-11-11'] });
  });

  // ───────────── Relatórios (cobertura que não existia) ─────────────
  it("D17 relatório soma só pedidos não cancelados e fecha com a lista de pedidos", async () => {
    const ctx = await setupStore();
    const o1 = JSON.parse((await order(ctx.slug, { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: ctx.productId, quantity: 2 }] })).body);
    await order(ctx.slug, { type: "DELIVERY", address: "Rua B, 2", paymentMethod: "CREDITO", items: [{ productId: ctx.productId, quantity: 1 }] });
    const o3 = JSON.parse((await order(ctx.slug, { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }] })).body);
    await app.inject({ method: "POST", url: `/api/orders/${o3.orderId}/status`, headers: { cookie: ctx.cookie }, payload: { status: "CANCELADO" } });
    const res = await app.inject({ method: "GET", url: "/api/reports/summary", headers: { cookie: ctx.cookie } });
    expect(res.statusCode).toBe(200);
    const r = JSON.parse(res.body);
    expect(r.orderCount).toBe(2);
    expect(r.revenueCents).toBe(3000 + 1500);
    expect(r.byPaymentMethod.DINHEIRO).toEqual({ count: 1, revenueCents: 3000 });
    expect((await app.inject({ method: "GET", url: "/api/reports/summary?from=lixo", headers: { cookie: ctx.cookie } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/reports/summary" })).statusCode).toBe(401);
    void o1;
  });
});
