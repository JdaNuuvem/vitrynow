// API-06 — jobs `payment.expire` (PIX vencido ⇒ cancelBySystem) e `refund.retry` (estorno pendente, até o teto de tentativas).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { orderStore } from "../helpers";
import { paymentExpireJob, PIX_EXPIRATION_MINUTES } from "../../src/jobs/paymentExpire";
import { refundRetryJob } from "../../src/jobs/refundRetry";
import { registeredJobs } from "../../src/jobs/registry";
import { MAX_REFUND_AUTO_ATTEMPTS } from "../../src/modules/orders/orders.service";
import { orderService } from "../../src/modules/orders/orders.module";
import { makeApp, registerStore, resetDb } from "../helpers";

vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../../src/lib/mercadopago";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const min = (n: number) => new Date(Date.now() - n * 60_000);

describe("API-06 — jobs de PIX", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(mp.cancelPayment).mockResolvedValue(undefined as never);
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

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
    return { owner: cookie!, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  // Pedido aguardando PIX: pedido criado e posto em "aguardando pagamento" com a cobrança nascida há `idadeMin` minutos.
  async function pedidoPix(l: Loja, idadeMin: number, extra: { expiresAt?: Date | null; status?: "PENDENTE" | "APROVADO" } = {}) {
    const res = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "DINHEIRO" } });
    const orderId = json(res).orderId as string;
    await prisma.order.update({ where: { id: orderId }, data: { paymentMethod: "PIX", awaitingPayment: (extra.status ?? "PENDENTE") === "PENDENTE" } });
    const payment = await prisma.payment.create({
      data: { orderId, storeId: await orderStore(orderId), providerPaymentId: `mp-${orderId}`, amountCents: 1000, status: extra.status ?? "PENDENTE", createdAt: min(idadeMin), expiresAt: extra.expiresAt ?? null },
    });
    return { orderId, paymentId: payment.id };
  }
  const statusDe = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
  const expirar = (limit = 100) => paymentExpireJob.runOnce({ now: new Date(), db: prisma, log, limit });
  const retentar = (limit = 50) => refundRetryJob.runOnce({ now: new Date(), db: prisma, log, limit });

  it("registrados no runner; prazo do PIX é 30 min", () => {
    expect(registeredJobs.map((j) => j.name)).toEqual(expect.arrayContaining(["payment.expire", "refund.retry"]));
    expect(PIX_EXPIRATION_MINUTES).toBe(30);
  });

  it("EXPIRA: PIX pendente com mais de 30 min é cancelado pelo sistema (cobrança fechada no provedor); com menos, não", async () => {
    const l = await loja();
    const velho = await pedidoPix(l, PIX_EXPIRATION_MINUTES + 1);
    const novo = await pedidoPix(l, PIX_EXPIRATION_MINUTES - 5);
    expect((await expirar()).processed).toBe(1);
    expect(await statusDe(velho.orderId)).toBe("CANCELADO");
    expect(await statusDe(novo.orderId)).not.toBe("CANCELADO");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: velho.paymentId } })).status).toBe("CANCELADO");
    expect(vi.mocked(mp.cancelPayment)).toHaveBeenCalledTimes(1);
  });

  it("o prazo do PROVEDOR (expiresAt) que vem antes vale; um expiresAt distante nunca passa dos 30 min", async () => {
    const l = await loja();
    const provedor = await pedidoPix(l, 15, { expiresAt: min(1) });
    const distante = await pedidoPix(l, 45, { expiresAt: new Date(Date.now() + 3_600_000) });
    const ainda = await pedidoPix(l, 10, { expiresAt: new Date(Date.now() + 3_600_000) });
    expect((await expirar()).processed).toBe(2);
    expect([await statusDe(provedor.orderId), await statusDe(distante.orderId)]).toEqual(["CANCELADO", "CANCELADO"]);
    expect(await statusDe(ainda.orderId)).not.toBe("CANCELADO");
  });

  it("NÃO toca: PIX já aprovado, pedido em dinheiro e pedido de OUTRA loja que ainda não venceu", async () => {
    const a = await loja();
    const b = await loja();
    const aprovado = await pedidoPix(a, 90, { status: "APROVADO" });
    const dinheiro = json(await app.inject({ method: "POST", url: `/stores/${a.store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: a.productId, quantity: 1 }], paymentMethod: "DINHEIRO" } })).orderId as string;
    const deB = await pedidoPix(b, 5);
    const velhoA = await pedidoPix(a, 40);
    expect((await expirar()).processed).toBe(1);
    expect(await statusDe(velhoA.orderId)).toBe("CANCELADO");
    for (const id of [aprovado.orderId, dinheiro, deB.orderId]) expect(await statusDe(id), id).not.toBe("CANCELADO");
  });

  it("IDEMPOTENTE e sob concorrência: dois jobs ao mesmo tempo e um terceiro depois deixam UM cancelamento e nenhum erro", async () => {
    const l = await loja();
    const p = await pedidoPix(l, 60);
    await Promise.all([expirar(), expirar()]);
    expect(await statusDe(p.orderId)).toBe("CANCELADO");
    expect((await expirar()).processed).toBe(0);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("LOTE: com limite 2 e 3 vencidos, o tick faz mais de um lote e cancela os 3, cada um uma vez", async () => {
    const l = await loja();
    for (let i = 0; i < 3; i += 1) await pedidoPix(l, 40 + i);
    expect((await expirar(2)).processed).toBe(3);
    expect((await expirar(2)).processed).toBe(0);
  });

  it("pagamento aprovado antes do job: o pedido não é cancelado como 'não pago'", async () => {
    const l = await loja();
    const p = await pedidoPix(l, 60);
    await prisma.payment.update({ where: { id: p.paymentId }, data: { status: "APROVADO" } }); // webhook aprovou; o pedido ainda marca "aguardando" (foto do meio da corrida)
    expect((await expirar()).processed).toBe(0);
    expect(await statusDe(p.orderId)).not.toBe("CANCELADO");
  });

  it("CORRIDA NO MEIO: o webhook aprova entre a leitura do job e o cancelamento ⇒ o pedido segue PAGO (não cancela, não estorna)", async () => {
    const l = await loja();
    const p = await pedidoPix(l, 60);
    const svc = orderService as unknown as { load: (s: string, o: string) => Promise<unknown> };
    const original = svc.load.bind(orderService);
    let primeira = true;
    vi.spyOn(svc, "load").mockImplementation(async (s: string, o: string) => {
      const velho = await original(s, o); // o job leu o pedido com a cobrança ainda PENDENTE...
      if (primeira) {
        primeira = false;
        await prisma.payment.update({ where: { id: p.paymentId }, data: { status: "APROVADO" } }); // ...e o webhook aprova logo depois
        await prisma.order.update({ where: { id: p.orderId }, data: { awaitingPayment: false } });
      }
      return velho;
    });
    await expirar();
    expect(await statusDe(p.orderId)).not.toBe("CANCELADO");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).status).toBe("APROVADO");
    expect(vi.mocked(mp.refundPayment)).not.toHaveBeenCalled();
    expect(vi.mocked(mp.cancelPayment)).not.toHaveBeenCalled();
  });

  it("cancelExpiredPix direto com a cobrança JÁ aprovada: devolve NONE, não cancela e não estorna (pago dentro do prazo)", async () => {
    const l = await loja();
    const p = await pedidoPix(l, 60);
    await prisma.payment.update({ where: { id: p.paymentId }, data: { status: "APROVADO" } });
    expect(await orderService.cancelExpiredPix(l.store.id, p.orderId)).toBe("NONE");
    expect(await statusDe(p.orderId)).not.toBe("CANCELADO");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).status).toBe("APROVADO");
    expect(vi.mocked(mp.refundPayment)).not.toHaveBeenCalled();
  });

  it("falha PERSISTENTE não bloqueia a fila: 2 pedidos que sempre falham ficam na frente e o 3º ainda é cancelado no MESMO tick; o log leva só o tipo/código, nunca o texto", async () => {
    const l = await loja();
    const a = await pedidoPix(l, 90);
    const b = await pedidoPix(l, 80);
    const c = await pedidoPix(l, 40);
    const original = orderService.cancelExpiredPix.bind(orderService);
    vi.spyOn(orderService, "cancelExpiredPix").mockImplementation(async (s, o) => {
      if (o === a.orderId || o === b.orderId) throw new Error("falha com segredo@x.com e APP_USR-123");
      return original(s, o);
    });
    expect((await expirar(2)).processed).toBe(1);
    expect(await statusDe(c.orderId)).toBe("CANCELADO");
    expect([await statusDe(a.orderId), await statusDe(b.orderId)]).not.toContain("CANCELADO");
    const texto = JSON.stringify(log.error.mock.calls);
    expect(texto).not.toContain("segredo@x.com");
    expect(texto).not.toContain("APP_USR");
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  // ───────────── refund.retry ─────────────
  async function estornoPendente(l: Loja) {
    const p = await pedidoPix(l, 5, { status: "APROVADO" });
    await prisma.order.update({ where: { id: p.orderId }, data: { awaitingPayment: false } });
    vi.mocked(mp.refundPayment).mockRejectedValue(new Error("fora do ar"));
    vi.mocked(mp.getPayment).mockRejectedValue(new Error("fora do ar"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await app.inject({ method: "POST", url: `/api/orders/${p.orderId}/cancel`, headers: { cookie: l.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect(r.statusCode).toBe(202);
    return p;
  }

  it("RETENTA o estorno pendente: com o provedor de volta, o job conclui (REEMBOLSADO + pedido CANCELADO) uma única vez", async () => {
    const l = await loja();
    const p = await estornoPendente(l);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).status).toBe("ESTORNO_PENDENTE");
    vi.mocked(mp.refundPayment).mockResolvedValue(undefined as never);
    vi.mocked(mp.refundPayment).mockClear();
    expect((await retentar()).processed).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).status).toBe("REEMBOLSADO");
    expect(await statusDe(p.orderId)).toBe("CANCELADO");
    expect(vi.mocked(mp.refundPayment)).toHaveBeenCalledTimes(1);
    expect((await retentar()).processed).toBe(0);
    expect(vi.mocked(mp.refundPayment)).toHaveBeenCalledTimes(1);
  });

  it(`TETO: cada execução soma 1 tentativa até ${MAX_REFUND_AUTO_ATTEMPTS}, o alerta único sai, e depois o job NÃO chama mais o provedor`, async () => {
    const l = await loja();
    const p = await estornoPendente(l);
    for (let i = 2; i <= MAX_REFUND_AUTO_ATTEMPTS; i += 1) await retentar();
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } });
    expect(row.refundAttempts).toBe(MAX_REFUND_AUTO_ATTEMPTS);
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { storeId: l.store.id, action: "order.refund_stuck" } })).toBe(1));
    vi.mocked(mp.refundPayment).mockClear();
    expect((await retentar()).processed).toBe(0);
    expect(vi.mocked(mp.refundPayment)).not.toHaveBeenCalled();
  });
});
