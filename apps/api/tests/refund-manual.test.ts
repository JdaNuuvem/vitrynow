// API-65 — "Registrar estorno feito no Mercado Pago" (RN-B1-08, RN-B1-16, CA-B1-15): OWNER, motivo por código, sem chamar o provedor.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { orderStore } from "./helpers";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
const refundPayment = vi.mocked(mp.refundPayment);

describe("API-65 — registrar estorno manual", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);

  async function pedido(status: "ESTORNO_PENDENTE" | "APROVADO" = "ESTORNO_PENDENTE") {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 2500 } })).product.id as string;
    const res = await app.inject({ method: "POST", url: `/stores/${store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 1 }], paymentMethod: "DINHEIRO" } });
    const orderId = json(res).orderId as string;
    await prisma.order.update({ where: { id: orderId }, data: { paymentMethod: "PIX", status: "CONFIRMADO", refundLockedAt: status === "ESTORNO_PENDENTE" ? new Date() : null } });
    const payment = await prisma.payment.create({
      data: { orderId, storeId: await orderStore(orderId), providerPaymentId: `mp-${orderId}`, amountCents: 2500, status, refundAttempts: 5, refundContext: { source: "PANEL", userId: null, actor: "OWNER", reason: { code: "ITEM_EM_FALTA" } } },
    });
    return { owner: cookie!, store, orderId, paymentId: payment.id, token: json(res).token as string };
  }
  async function staffCookie(owner: string) {
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0]!;
  }
  const registrar = (cookie: string, orderId: string, payload: Record<string, unknown> = { code: "DEVOLVIDO_NO_APP_MP" }) =>
    app.inject({ method: "POST", url: `/api/orders/${orderId}/refund/manual`, headers: { cookie }, payload });
  const audits = (storeId: string) => prisma.auditLog.findMany({ where: { storeId, action: "order.refund_manual" } });

  it("STAFF recebe 403 FORBIDDEN_ROLE e nada muda", async () => {
    const c = await pedido();
    const r = await registrar(await staffCookie(c.owner), c.orderId);
    expect(r.statusCode).toBe(403);
    expect(json(r).code).toBe("FORBIDDEN_ROLE");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).status).toBe("ESTORNO_PENDENTE");
  });

  it("motivo obrigatório: sem código ou código fora da lista => 400", async () => {
    const c = await pedido();
    expect((await registrar(c.owner, c.orderId, {})).statusCode).toBe(400);
    expect((await registrar(c.owner, c.orderId, { code: "QUALQUER" })).statusCode).toBe(400);
  });

  it("feliz: pagamento vira REEMBOLSADO (manual), pedido CANCELADO e destravado, provedor NÃO chamado, auditoria sem texto livre", async () => {
    const c = await pedido();
    const r = await registrar(c.owner, c.orderId, { code: "CONTA_ANTIGA", note: "ana@x.com" });
    expect(r.statusCode, r.body).toBe(200);
    expect(json(r).order.status).toBe("CANCELADO");
    expect(json(r).order.payment.refundManual).toBe(true);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
    expect(p.status).toBe("REEMBOLSADO");
    expect(p.refundManualAt).not.toBeNull();
    expect(p.refundManualCode).toBe("CONTA_ANTIGA");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: c.orderId } })).refundLockedAt).toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();
    const a = await audits(c.store.id);
    expect(a).toHaveLength(1);
    expect(a[0]!.metadata).toEqual({ code: "CONTA_ANTIGA", amountCents: 2500 });
    expect(JSON.stringify(a[0])).not.toContain("ana@x.com");
  });

  it("também vale para pagamento APROVADO de pedido ativo (estorno nunca iniciado, ex.: conta antiga)", async () => {
    const c = await pedido("APROVADO");
    expect((await registrar(c.owner, c.orderId)).statusCode).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).status).toBe("REEMBOLSADO");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: c.orderId } })).status).toBe("CANCELADO");
  });

  it("pedido sem pagamento a estornar (PENDENTE) => 409 NOT_REFUND_PENDING", async () => {
    const c = await pedido();
    await prisma.payment.update({ where: { id: c.paymentId }, data: { status: "PENDENTE" } });
    const r = await registrar(c.owner, c.orderId);
    expect(r.statusCode).toBe(409);
    expect(json(r).code).toBe("NOT_REFUND_PENDING");
  });

  it("idempotente: repetir => 200, sem nova auditoria nem novo histórico; simultâneas registram uma vez", async () => {
    const c = await pedido();
    const rs = await Promise.all([registrar(c.owner, c.orderId), registrar(c.owner, c.orderId), registrar(c.owner, c.orderId)]);
    for (const r of rs) expect([200, 409]).toContain(r.statusCode);
    expect((await registrar(c.owner, c.orderId)).statusCode).toBe(200);
    expect(await audits(c.store.id)).toHaveLength(1);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: c.orderId, kind: "CANCEL" } })).toBe(1);
  });

  it("o cliente vê o dinheiro como estornado (sem promessa de prazo) e o painel marca o manual", async () => {
    const c = await pedido();
    await registrar(c.owner, c.orderId);
    const track = await app.inject({ method: "GET", url: `/stores/${c.store.slug}/orders/${c.orderId}/tracking`, headers: { "x-order-token": c.token } });
    expect(json(track).cancelReason.moneyLine).toMatch(/foi estornado/);
    expect(track.body).not.toMatch(/refundManual|DEVOLVIDO_NO_APP_MP/);
  });

  it("isolamento: o dono da loja B não registra estorno da loja A (404)", async () => {
    const a = await pedido();
    const { cookie: donoB } = await registerStore(app);
    expect((await registrar(donoB!, a.orderId)).statusCode).toBe(404);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: a.paymentId } })).status).toBe("ESTORNO_PENDENTE");
  });
});
