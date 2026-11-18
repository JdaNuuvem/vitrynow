// API-55 — PIX aguardando pagamento visível (RN-PP-01..04): lista somente leitura + "Conferir pagamento" (1 consulta, 1 por minuto por pedido).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb, useMockedProvider, enablePro } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
const createPix = vi.mocked(mp.createPixPayment);
const getPayment = vi.mocked(mp.getPayment);

describe("API-55 — PIX aguardando pagamento", { timeout: 60_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    useMockedProvider(mp);
    vi.clearAllMocks();
    app = makeApp();
    await app.ready();
  }, 60_000);
  afterEach(async () => {
    await app.close();
    await resetDb();
  }, 60_000);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  let seq = 0;

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
    return { cookie: cookie!, store, productId };
  }
  type Ctx = Awaited<ReturnType<typeof loja>>;

  async function pixOrder(ctx: Ctx) {
    seq += 1;
    const providerPaymentId = `mp-aw-${Date.now()}-${seq}`;
    createPix.mockResolvedValueOnce({ providerPaymentId, status: "pending", pixQrCode: "0002SEGREDO", pixQrCodeBase64: "AA", expiresAt: new Date(Date.now() + 1_800_000) });
    const res = await app.inject({ method: "POST", url: `/stores/${ctx.store.slug}/orders`, payload: { type: "BALCAO", customerName: "Ana", items: [{ productId: ctx.productId, quantity: 1 }], paymentMethod: "PIX" } });
    expect(res.statusCode).toBe(201);
    return { orderId: json(res).orderId as string, providerPaymentId };
  }
  async function staffCookie(owner: string) {
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await enablePro(app, owner);
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0]!;
  }
  const lista = (cookie: string) => app.inject({ method: "GET", url: "/api/orders/awaiting-payment", headers: { cookie } });
  const conferir = (cookie: string, id: string) => app.inject({ method: "POST", url: `/api/orders/${id}/payment/check`, headers: { cookie } });
  async function provider(providerPaymentId: string, status: string, over: Record<string, unknown> = {}) {
    const p = await prisma.payment.findUnique({ where: { providerPaymentId } });
    getPayment.mockResolvedValue({ providerPaymentId, status, externalReference: p?.orderId ?? null, amountCents: p?.amountCents ?? null, currency: "BRL", ...over } as never);
  }

  it("RN-PP-01: lista só os PIX aguardando da própria loja (OWNER e STAFF), sem dado do provedor; contador bate", async () => {
    const a = await loja();
    const p1 = await pixOrder(a);
    const p2 = await pixOrder(a);
    const b = await loja();
    await pixOrder(b);
    for (const cookie of [a.cookie, await staffCookie(a.cookie)]) {
      const r = await lista(cookie);
      expect(r.statusCode).toBe(200);
      const body = json(r);
      expect(body.count).toBe(2);
      expect(body.orders.map((o: { id: string }) => o.id)).toEqual([p1.orderId, p2.orderId]);
      expect(body.orders[0]).toMatchObject({ customerName: "Ana", totalCents: 1000 });
      expect(body.orders[0].secondsLeft).toBeGreaterThan(1700);
      expect(r.body).not.toMatch(/0002SEGREDO|pixQrCode|providerPaymentId|mp-aw-|idempotencyKey/);
    }
    expect(json(await lista(b.cookie)).count).toBe(1);
  });

  it("sem sessão => 401", async () => {
    expect((await app.inject({ method: "GET", url: "/api/orders/awaiting-payment" })).statusCode).toBe(401);
  });

  it("RN-PP-02/04: pedido já pago ou expirado some da lista", async () => {
    const a = await loja();
    const pago = await pixOrder(a);
    const expirado = await pixOrder(a);
    await pixOrder(a);
    await prisma.payment.update({ where: { providerPaymentId: pago.providerPaymentId }, data: { status: "APROVADO" } });
    await prisma.order.update({ where: { id: pago.orderId }, data: { awaitingPayment: false } });
    await prisma.payment.update({ where: { providerPaymentId: expirado.providerPaymentId }, data: { status: "EXPIRADO" } });
    await prisma.order.update({ where: { id: expirado.orderId }, data: { status: "CANCELADO" } });
    expect(json(await lista(a.cookie)).count).toBe(1);
  });

  it("RN-PP-03: conferir => PAID quando o provedor confirma valor e referência (libera o pedido, 1 vez)", async () => {
    const a = await loja();
    const p = await pixOrder(a);
    await provider(p.providerPaymentId, "approved");
    const r = await conferir(a.cookie, p.orderId);
    expect(r.statusCode, r.body).toBe(200);
    expect(json(r)).toEqual({ result: "PAID" });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: p.orderId }, include: { payment: true } });
    expect({ awaiting: o.awaitingPayment, payment: o.payment?.status }).toEqual({ awaiting: false, payment: "APROVADO" });
    expect(json(await lista(a.cookie)).count).toBe(0);
    expect(json(await conferir(a.cookie, p.orderId))).toEqual({ result: "PAID" }); // já pago: sem nova consulta nem 429
  });

  it("RN-PP-03: ainda pendente no provedor => NOT_PAID e nada muda", async () => {
    const a = await loja();
    const p = await pixOrder(a);
    await provider(p.providerPaymentId, "pending");
    expect(json(await conferir(a.cookie, p.orderId))).toEqual({ result: "NOT_PAID" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).awaitingPayment).toBe(true);
  });

  it("nunca aprova sem conferir valor/referência: o provedor diz approved com valor diferente => NOT_PAID e o pedido segue aguardando", async () => {
    const a = await loja();
    const p = await pixOrder(a);
    await provider(p.providerPaymentId, "approved", { amountCents: 1 });
    expect(json(await conferir(a.cookie, p.orderId))).toEqual({ result: "NOT_PAID" });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: p.orderId }, include: { payment: true } });
    expect({ awaiting: o.awaitingPayment, payment: o.payment?.status }).toEqual({ awaiting: true, payment: "PENDENTE" });
  });

  it("falha do provedor => UNVERIFIED (200), sem vazar o erro", async () => {
    const a = await loja();
    const p = await pixOrder(a);
    getPayment.mockRejectedValue(new Error("fora do ar ana@x.com"));
    const r = await conferir(a.cookie, p.orderId);
    expect(r.statusCode).toBe(200);
    expect(json(r)).toEqual({ result: "UNVERIFIED" });
    expect(r.body).not.toContain("ana@x.com");
  });

  it("limite: 1 conferência por minuto por pedido => 429 RATE_LIMITED; outro pedido não é afetado", async () => {
    const a = await loja();
    const p1 = await pixOrder(a);
    const p2 = await pixOrder(a);
    await provider(p1.providerPaymentId, "pending");
    expect((await conferir(a.cookie, p1.orderId)).statusCode).toBe(200);
    const segunda = await conferir(a.cookie, p1.orderId);
    expect(segunda.statusCode).toBe(429);
    expect(json(segunda).code).toBe("RATE_LIMITED");
    expect(getPayment).toHaveBeenCalledTimes(1);
    await provider(p2.providerPaymentId, "pending");
    expect((await conferir(a.cookie, p2.orderId)).statusCode).toBe(200);
  });

  it("isolamento: conferir pedido de OUTRA loja => 404 e o provedor não é consultado", async () => {
    const a = await loja();
    const p = await pixOrder(a);
    const b = await loja();
    const r = await conferir(b.cookie, p.orderId);
    expect(r.statusCode).toBe(404);
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("pedido sem PIX (dinheiro) => 409 NOT_AWAITING_PAYMENT", async () => {
    const a = await loja();
    const res = await app.inject({ method: "POST", url: `/stores/${a.store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: a.productId, quantity: 1 }], paymentMethod: "DINHEIRO" } });
    const r = await conferir(a.cookie, json(res).orderId);
    expect(r.statusCode).toBe(409);
    expect(json(r).code).toBe("NOT_AWAITING_PAYMENT");
  });
});
