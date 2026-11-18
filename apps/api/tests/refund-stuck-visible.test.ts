// API-69 — estorno preso visível para o dono (RN-REF-01..05, CA-REF-01..04).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { OrderService, MAX_REFUND_AUTO_ATTEMPTS } from "../src/modules/orders/orders.service";
import { prismaAuditLogger } from "../src/shared/audit";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
const refundPayment = vi.mocked(mp.refundPayment);
const getPayment = vi.mocked(mp.getPayment);

describe("API-69 — estorno preso visível", () => {
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

  async function pedido(owner?: { cookie: string; store: { id: string; slug: string } }, attempts = MAX_REFUND_AUTO_ATTEMPTS) {
    let cookie = owner?.cookie;
    let store = owner?.store;
    if (!cookie || !store) {
      const reg = await registerStore(app);
      cookie = reg.cookie!;
      store = json(reg.response).store as { id: string; slug: string };
    }
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie }, payload: { categoryId: cat, name: "P", priceCents: 3000 } })).product.id as string;
    const res = await app.inject({ method: "POST", url: `/stores/${store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 1 }], paymentMethod: "DINHEIRO" } });
    const orderId = json(res).orderId as string;
    await prisma.order.update({ where: { id: orderId }, data: { paymentMethod: "PIX", status: "CONFIRMADO", refundLockedAt: new Date() } });
    const payment = await prisma.payment.create({
      data: {
        orderId, providerPaymentId: `mp-${orderId}`, amountCents: 3000, status: "ESTORNO_PENDENTE", refundAttempts: attempts, refundLastError: "x",
        refundContext: { source: "PANEL", userId: null, actor: "OWNER", reason: { code: "ITEM_EM_FALTA" } },
      },
    });
    return { owner: cookie, store, orderId, paymentId: payment.id };
  }
  async function staffCookie(owner: string) {
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0]!;
  }
  const stuckList = (cookie: string) => app.inject({ method: "GET", url: "/api/orders/refund-stuck", headers: { cookie } });
  const detail = async (cookie: string, id: string) => json(await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie } })).order;

  it("CA-REF-01/03: na 5ª falha automática sai 1 evento (só orderId) e 1 alerta; na 6ª nenhum novo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    refundPayment.mockRejectedValue(new Error("fora do ar"));
    getPayment.mockRejectedValue(new Error("fora do ar"));
    const c = await pedido(undefined, MAX_REFUND_AUTO_ATTEMPTS - 1);
    const publish = vi.fn();
    const svc = new OrderService(prisma, prismaAuditLogger, publish);
    await svc.attemptRefund(c.paymentId); // 5ª: cruza o teto
    const stuck = publish.mock.calls.filter(([, m]) => m.type === "payment.refund_stuck");
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toEqual([c.store.id, { type: "payment.refund_stuck", orderId: c.orderId }]); // sem valor nem dado pessoal
    await svc.attemptRefund(c.paymentId); // 6ª
    expect(publish.mock.calls.filter(([, m]) => m.type === "payment.refund_stuck")).toHaveLength(1);
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { storeId: c.store.id, action: "order.refund_stuck" } })).toBe(1));
  });

  it("abaixo do teto: nenhum evento e o pedido não aparece como preso", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    refundPayment.mockRejectedValue(new Error("fora do ar"));
    getPayment.mockRejectedValue(new Error("fora do ar"));
    const c = await pedido(undefined, 1);
    const publish = vi.fn();
    await new OrderService(prisma, prismaAuditLogger, publish).attemptRefund(c.paymentId);
    expect(publish.mock.calls.some(([, m]) => m.type === "payment.refund_stuck")).toBe(false);
    expect((await detail(c.owner, c.orderId)).payment.refundStuck).toBe(false);
    expect(json(await stuckList(c.owner)).count).toBe(0);
  });

  it("CA-REF-02: OWNER e STAFF veem o selo no detalhe; STAFF não recebe a lista (403) e o corpo não traz contador nem erro", async () => {
    const c = await pedido();
    const staff = await staffCookie(c.owner);
    for (const cookie of [c.owner, staff]) {
      const d = await detail(cookie, c.orderId);
      expect(d.payment.refundStuck).toBe(true);
      expect(JSON.stringify(d)).not.toMatch(/refundAttempts|refundLastError|refundContext/);
    }
    const r = await stuckList(staff);
    expect(r.statusCode).toBe(403);
    expect(json(r).code).toBe("FORBIDDEN_ROLE");
  });

  it("CA-REF-04: a lista do OWNER conta só pedidos ainda presos (e só da própria loja)", async () => {
    const a = await pedido();
    const outro = await pedido({ cookie: a.owner, store: a.store }); // mesma loja, também preso
    const encerrado = await pedido({ cookie: a.owner, store: a.store });
    await prisma.payment.update({ where: { id: encerrado.paymentId }, data: { refundAbandonedAt: new Date(), refundAbandonCode: "OUTRO" } });
    const abaixo = await pedido({ cookie: a.owner, store: a.store }, 2);
    const lojaB = await pedido(); // outra loja, presa
    const r = json(await stuckList(a.owner));
    expect(r.count).toBe(2);
    expect(r.orders.map((o: { id: string }) => o.id).sort()).toEqual([a.orderId, outro.orderId].sort());
    expect(JSON.stringify(r)).not.toContain(abaixo.orderId);
    expect(JSON.stringify(r)).not.toContain(lojaB.orderId);
    expect(json(await stuckList(lojaB.owner)).count).toBe(1);
  });

  it("RN-REF-05: o alerta some quando o estorno é encerrado (API-61) e a marca 'Estorno não concluído' aparece no histórico", async () => {
    const c = await pedido();
    expect(json(await stuckList(c.owner)).count).toBe(1);
    const r = await app.inject({ method: "POST", url: `/api/orders/${c.orderId}/refund/abandon`, headers: { cookie: c.owner }, payload: { code: "MP_RECUSA" } });
    expect(r.statusCode, r.body).toBe(200);
    expect(json(await stuckList(c.owner)).count).toBe(0);
    const d = await detail(c.owner, c.orderId);
    expect(d.payment.refundStuck).toBe(false);
    expect(d.payment.refundAbandoned).toBe(true);
    const h = await app.inject({ method: "GET", url: "/api/orders/history?period=today", headers: { cookie: c.owner } });
    expect(h.statusCode, h.body).toBe(200);
    const item = json(h).rows.find((i: { id: string }) => i.id === c.orderId);
    expect(item.refundAbandoned).toBe(true);
    expect(item.refundStuck).toBe(false);
  });
});
