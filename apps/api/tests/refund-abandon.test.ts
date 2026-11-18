// API-61 — "Encerrar sem estorno" (RN-ABD-01..06, CA-ABD-01..07): OWNER, só com estorno preso, auditoria na mesma transação, idempotente.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { MAX_REFUND_AUTO_ATTEMPTS } from "../src/modules/orders/orders.service";
import { makeApp, registerStore, resetDb, enablePro } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
const refundPayment = vi.mocked(mp.refundPayment);

describe("API-61 — encerrar estorno preso sem devolver por aqui", () => {
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

  async function pedidoComEstornoPreso(attempts = MAX_REFUND_AUTO_ATTEMPTS) {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 4500 } })).product.id as string;
    const res = await app.inject({ method: "POST", url: `/stores/${store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 1 }], paymentMethod: "DINHEIRO" } });
    const orderId = json(res).orderId as string;
    await prisma.order.update({ where: { id: orderId }, data: { paymentMethod: "PIX", status: "CONFIRMADO", refundLockedAt: new Date() } });
    const payment = await prisma.payment.create({
      data: {
        orderId,
        providerPaymentId: `mp-${orderId}`,
        amountCents: 4500,
        status: "ESTORNO_PENDENTE",
        refundAttempts: attempts,
        refundLastError: "x",
        refundContext: { source: "PANEL", userId: null, actor: "OWNER", reason: { code: "ITEM_EM_FALTA" } },
      },
    });
    return { owner: cookie!, store, orderId, paymentId: payment.id, token: json(res).token as string };
  }
  async function staffCookie(owner: string) {
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await enablePro(app, owner);
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0]!;
  }
  const encerrar = (cookie: string, orderId: string, payload: Record<string, unknown> = { code: "MP_RECUSA" }) =>
    app.inject({ method: "POST", url: `/api/orders/${orderId}/refund/abandon`, headers: { cookie }, payload });
  const audits = (storeId: string) => prisma.auditLog.findMany({ where: { storeId, action: "order.refund_abandoned" } });

  it("CA-ABD-01: STAFF recebe 403 FORBIDDEN_ROLE e nada muda", async () => {
    const c = await pedidoComEstornoPreso();
    const r = await encerrar(await staffCookie(c.owner), c.orderId);
    expect(r.statusCode).toBe(403);
    expect(json(r).code).toBe("FORBIDDEN_ROLE");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: c.orderId } })).status).toBe("CONFIRMADO");
  });

  it("CA-ABD-02: estorno ainda tentável (abaixo do teto) => 409 REFUND_STILL_POSSIBLE", async () => {
    const c = await pedidoComEstornoPreso(MAX_REFUND_AUTO_ATTEMPTS - 1);
    const r = await encerrar(c.owner, c.orderId);
    expect(r.statusCode).toBe(409);
    expect(json(r).code).toBe("REFUND_STILL_POSSIBLE");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).refundAbandonedAt).toBeNull();
  });

  it("CA-ABD-03: sem motivo, código fora da lista ou nota fora de 1..200 => 400", async () => {
    const c = await pedidoComEstornoPreso();
    expect((await encerrar(c.owner, c.orderId, {})).statusCode).toBe(400);
    expect((await encerrar(c.owner, c.orderId, { code: "QUALQUER" })).statusCode).toBe(400);
    expect((await encerrar(c.owner, c.orderId, { code: "OUTRO", note: "" })).statusCode).toBe(400);
    expect((await encerrar(c.owner, c.orderId, { code: "OUTRO", note: "x".repeat(201) })).statusCode).toBe(400);
  });

  it("pedido sem estorno pendente => 409 NOT_REFUND_PENDING", async () => {
    const c = await pedidoComEstornoPreso();
    await prisma.payment.update({ where: { id: c.paymentId }, data: { status: "APROVADO" } });
    const r = await encerrar(c.owner, c.orderId);
    expect(r.statusCode).toBe(409);
    expect(json(r).code).toBe("NOT_REFUND_PENDING");
  });

  it("CA-ABD-04/06/07: cancela, destrava, NÃO vira REEMBOLSADO, não chama o provedor, auditoria sem texto livre, cliente sem promessa", async () => {
    const c = await pedidoComEstornoPreso();
    const r = await encerrar(c.owner, c.orderId, { code: "PAGAMENTO_ANTIGO", note: "cliente ana@x.com combinou" });
    expect(r.statusCode, r.body).toBe(200);
    expect(json(r).order.status).toBe("CANCELADO");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: c.orderId } });
    expect(o.status).toBe("CANCELADO");
    expect(o.refundLockedAt).toBeNull();
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
    expect(p.status).toBe("ESTORNO_PENDENTE"); // o dinheiro continua como recebido: nunca REEMBOLSADO
    expect(p.refundAbandonedAt).not.toBeNull();
    expect(p.refundAbandonCode).toBe("PAGAMENTO_ANTIGO");
    expect(refundPayment).not.toHaveBeenCalled();
    const a = await audits(c.store.id);
    expect(a).toHaveLength(1);
    expect(a[0]!.metadata).toEqual({ code: "PAGAMENTO_ANTIGO", amountCents: 4500 });
    expect(JSON.stringify(a[0])).not.toContain("ana@x.com");
    const hist = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: c.orderId, kind: "CANCEL" } });
    expect(hist.customerMessage).toBe("Seu pedido foi cancelado. A loja entrará em contato sobre a devolução.");
    const track = await app.inject({ method: "GET", url: `/stores/${c.store.slug}/orders/${c.orderId}/tracking`, headers: { "x-order-token": c.token } });
    expect(track.statusCode).toBe(200);
    expect(track.body).not.toMatch(/estorno de R\$|em andamento|foi estornado/);
    const d = await app.inject({ method: "GET", url: `/api/orders/${c.orderId}`, headers: { cookie: c.owner } });
    expect(json(d).order.payment.refundPending).toBe(false);
    expect(json(d).order.payment.refundAbandoned).toBe(true);
  });

  it("CA-ABD-05: repetir a chamada => 200 sem novo registro de auditoria nem de histórico", async () => {
    const c = await pedidoComEstornoPreso();
    expect((await encerrar(c.owner, c.orderId)).statusCode).toBe(200);
    expect((await encerrar(c.owner, c.orderId)).statusCode).toBe(200);
    expect(await audits(c.store.id)).toHaveLength(1);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: c.orderId, kind: "CANCEL" } })).toBe(1);
  });

  it("chamadas simultâneas: um único encerramento", async () => {
    const c = await pedidoComEstornoPreso();
    const rs = await Promise.all([encerrar(c.owner, c.orderId), encerrar(c.owner, c.orderId), encerrar(c.owner, c.orderId)]);
    for (const r of rs) expect([200, 409]).toContain(r.statusCode);
    expect(rs.some((r) => r.statusCode === 200)).toBe(true);
    expect(await audits(c.store.id)).toHaveLength(1);
  });

  it("depois de encerrado, o 'Tentar estorno' não chama o provedor", async () => {
    const c = await pedidoComEstornoPreso();
    await encerrar(c.owner, c.orderId);
    await app.inject({ method: "POST", url: `/api/orders/${c.orderId}/refund/retry`, headers: { cookie: c.owner } });
    expect(refundPayment).not.toHaveBeenCalled();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).status).toBe("ESTORNO_PENDENTE");
  });

  it("isolamento: o dono da loja B não encerra o estorno da loja A (404) e nada muda", async () => {
    const a = await pedidoComEstornoPreso();
    const { cookie: donoB } = await registerStore(app);
    const r = await encerrar(donoB!, a.orderId);
    expect(r.statusCode).toBe(404);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: a.paymentId } })).refundAbandonedAt).toBeNull();
  });
});
