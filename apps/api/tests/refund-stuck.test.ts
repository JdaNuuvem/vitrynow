// API-06a — estorno: teto de tentativas com alerta único, código do provedor no log (sem mensagem/PII) e
// `refundLastError`/`refundAttempts` fora de qualquer resposta pública (parecer da Nightingale à API-02).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { MAX_REFUND_AUTO_ATTEMPTS, providerErrorCode, refundAutoRetryable } from "../src/modules/orders/orders.service";
import { orderService } from "../src/modules/orders/orders.module";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
const refundPayment = vi.mocked(mp.refundPayment);
const getPayment = vi.mocked(mp.getPayment);

describe("API-06a — estorno travado", () => {
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

  async function pedidoPagoPendenteDeEstorno() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
    const res = await app.inject({ method: "POST", url: `/stores/${store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 1 }], paymentMethod: "DINHEIRO" } });
    const orderId = json(res).orderId as string;
    await prisma.order.update({ where: { id: orderId }, data: { paymentMethod: "PIX" } });
    const payment = await prisma.payment.create({ data: { orderId, providerPaymentId: `mp-${orderId}`, amountCents: 1000, status: "APROVADO" } });
    // O acompanhamento público exige o token do pedido (NG-16): vem na resposta da criação.
    return { owner: cookie!, store, orderId, paymentId: payment.id, token: json(res).token as string };
  }
  const cancelar = (c: { owner: string; orderId: string }) =>
    app.inject({ method: "POST", url: `/api/orders/${c.orderId}/cancel`, headers: { cookie: c.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
  const tentar = (c: { owner: string; orderId: string }) => app.inject({ method: "POST", url: `/api/orders/${c.orderId}/refund/retry`, headers: { cookie: c.owner } });
  const stuckRows = (storeId: string) => prisma.auditLog.count({ where: { storeId, action: "order.refund_stuck" } });

  it("providerErrorCode: só status e código de causa, em lista restrita; nunca mensagem, descrição nem e-mail", () => {
    expect(providerErrorCode({ status: 400, message: "token APP_USR-123 de ana@x.com", cause: [{ code: 2000, description: "ana@x.com" }] })).toBe("status=400 code=2000");
    expect(providerErrorCode({ statusCode: 503 })).toBe("status=503 code=?");
    expect(providerErrorCode({ status: "ana@x.com", cause: [{ code: "<script>" }] })).toBe("status=? code=?");
    expect(providerErrorCode(new Error("timeout de ana@x.com"))).toBe("status=? code=?");
    expect(providerErrorCode(null)).toBe("status=? code=?");
    expect(providerErrorCode({ status: "x".repeat(40) })).toBe("status=? code=?");
  });

  it("o log do estorno traz o CÓDIGO do provedor e nada de mensagem/PII", async () => {
    const c = await pedidoPagoPendenteDeEstorno();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    refundPayment.mockRejectedValue(Object.assign(new Error("falha para ana@x.com com token APP_USR-999"), { status: 400, cause: [{ code: 2064, description: "ana@x.com" }] }));
    getPayment.mockRejectedValue(Object.assign(new Error("sem rede"), { status: 503 }));
    const r = await cancelar(c);
    expect(r.statusCode).toBe(202);
    const linhas = log.mock.calls.map((a) => a.map(String).join(" ")).filter((l) => l.includes("[estorno]"));
    expect(linhas.some((l) => l.includes("status=400 code=2064"))).toBe(true);
    expect(linhas.some((l) => l.includes("status=503"))).toBe(true);
    for (const l of linhas) for (const proibido of ["ana@x.com", "APP_USR", "falha para", "sem rede"]) expect(l, proibido).not.toContain(proibido);
  });

  it(`TETO: na ${MAX_REFUND_AUTO_ATTEMPTS}ª tentativa que falha sai UM alerta (auditoria); as seguintes não repetem; o manual continua valendo`, async () => {
    expect(MAX_REFUND_AUTO_ATTEMPTS).toBe(5); // o teto é decisão de produto: mudar exige mudar este número de propósito
    const c = await pedidoPagoPendenteDeEstorno();
    vi.spyOn(console, "error").mockImplementation(() => {});
    refundPayment.mockRejectedValue(new Error("fora do ar"));
    getPayment.mockRejectedValue(new Error("fora do ar"));
    expect((await cancelar(c)).statusCode).toBe(202); // tentativa 1
    for (let i = 2; i < MAX_REFUND_AUTO_ATTEMPTS; i++) await tentar(c);
    const antes = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
    expect(antes.refundAttempts).toBe(MAX_REFUND_AUTO_ATTEMPTS - 1);
    expect(refundAutoRetryable(antes)).toBe(true);
    expect(await stuckRows(c.store.id)).toBe(0);
    await tentar(c); // cruza o teto
    await vi.waitFor(async () => expect(await stuckRows(c.store.id)).toBe(1));
    const depois = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
    expect(depois.refundAttempts).toBe(MAX_REFUND_AUTO_ATTEMPTS);
    expect(refundAutoRetryable(depois)).toBe(false); // o job automático (API-06) para aqui
    await tentar(c);
    await tentar(c); // o manual do dono continua sendo possível...
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).refundAttempts).toBe(MAX_REFUND_AUTO_ATTEMPTS + 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(await stuckRows(c.store.id)).toBe(1); // ...e o alerta NÃO se repete
    const row = await prisma.auditLog.findFirstOrThrow({ where: { storeId: c.store.id, action: "order.refund_stuck" } });
    expect(row.metadata).toEqual({ attempts: MAX_REFUND_AUTO_ATTEMPTS });
    // por fim o provedor volta e o estorno conclui mesmo depois do teto
    refundPayment.mockResolvedValue(undefined);
    const ok = await tentar(c);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).status).toBe("REEMBOLSADO");
  });

  it("tentativas simultâneas que cruzam o teto emitem UM alerta só", async () => {
    const c = await pedidoPagoPendenteDeEstorno();
    vi.spyOn(console, "error").mockImplementation(() => {});
    refundPayment.mockRejectedValue(new Error("fora do ar"));
    getPayment.mockRejectedValue(new Error("fora do ar"));
    await cancelar(c);
    for (let i = 2; i < MAX_REFUND_AUTO_ATTEMPTS - 1; i++) await tentar(c); // deixa em teto-2
    await Promise.all([tentar(c), tentar(c), tentar(c), tentar(c)]); // cruzam juntas
    await vi.waitFor(async () => expect(await stuckRows(c.store.id)).toBe(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(await stuckRows(c.store.id)).toBe(1);
  });

  it("falha TARDIA de uma tentativa que perdeu a corrida (o pagamento já foi REEMBOLSADO por outra): contador e alerta ficam intactos", async () => {
    const c = await pedidoPagoPendenteDeEstorno();
    await prisma.payment.update({ where: { id: c.paymentId }, data: { status: "REEMBOLSADO", refundAttempts: MAX_REFUND_AUTO_ATTEMPTS - 1 } });
    const registrar = (orderService as unknown as { noteRefundFailure: (paymentId: string, order: { id: string; storeId: string }, origin: unknown, message: string) => Promise<void> }).noteRefundFailure.bind(orderService);
    await registrar(c.paymentId, { id: c.orderId, storeId: c.store.id }, { source: "PANEL", userId: null, actor: "OWNER", reason: { code: "ITEM_EM_FALTA" } }, "texto qualquer");
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
    expect(p.refundAttempts).toBe(MAX_REFUND_AUTO_ATTEMPTS - 1); // não contou: o UPDATE só vale em ESTORNO_PENDENTE
    expect(p.refundLastError).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(await stuckRows(c.store.id)).toBe(0); // e não alertou
  });

  it("NÃO VAZA: `refundLastError`, `refundAttempts` e o texto de erro não saem no payment-status público nem no corpo do 202 público", async () => {
    const c = await pedidoPagoPendenteDeEstorno();
    vi.spyOn(console, "error").mockImplementation(() => {});
    refundPayment.mockRejectedValue(new Error("fora do ar"));
    getPayment.mockRejectedValue(new Error("fora do ar"));
    await cancelar(c);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
    expect(p.refundLastError).toBeTruthy(); // o texto existe no banco...
    const status = await app.inject({ method: "GET", url: `/stores/${c.store.slug}/orders/${c.orderId}/payment-status`, headers: { "x-order-token": c.token } });
    expect(status.statusCode).toBe(200);
    for (const proibido of ["refundLastError", "refundAttempts", "Tentaremos novamente", "Não foi possível estornar", "refundContext", "idempotencyKey", "providerPaymentId"]) {
      expect(status.body, proibido).not.toContain(proibido);
    }
  });
});
