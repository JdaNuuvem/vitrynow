// API-07 / P-1 (ADR-0001): o checkout cobra na conta do Mercado Pago DA LOJA, nunca na da plataforma; duas lojas não se misturam; o webhook
// usa a conta do pagamento local e trata `?store=` só como DICA. Provedor 100% fake (FakePixGateway); nenhum mock de lib/mercadopago.
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { FakePixGateway } from "../src/modules/storePayments/gateway";
import { connectPixAccount, makeApp, registerStore, resetDb } from "./helpers";

const SECRET = "test-webhook-secret";

describe("PIX por loja no checkout (P-1)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    vi.clearAllMocks();
    FakePixGateway.reset();
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

  async function loja(opts: { pix?: boolean } = {}) {
    seq += 1;
    const { cookie, response } = await registerStore(app, { slug: `pix-${seq}-${Date.now() % 100000}`, code: `K${seq}`, pix: false });
    const { id: storeId, slug } = json(response).store as { id: string; slug: string };
    const category = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie!}, payload: { categoryId: category, name: "P", priceCents: 2000 } })).product.id as string;
    const account = opts.pix === false ? null : await connectPixAccount(storeId, `vendedor-loja-${seq}`);
    return { cookie: cookie!, storeId, slug, productId, account };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  const pedidoPix = (l: Loja) =>
    app.inject({ method: "POST", url: `/stores/${l.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "PIX" } });

  const assinado = (dataId: string, store?: string) => {
    const ts = String(Date.now());
    const requestId = `req-${Math.random().toString(36).slice(2)}`;
    const v1 = createHmac("sha256", SECRET).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
    return app.inject({
      method: "POST",
      url: `/api/payments/webhook${store ? `?store=${store}` : ""}`,
      headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
      payload: { type: "payment", data: { id: dataId } },
    });
  };

  it("a cobrança sai na conta DA LOJA: o pagamento guarda a conta, o vendedor do provedor é o da loja, com prazo de 30 min", async () => {
    const a = await loja();
    const res = await pedidoPix(a);
    expect(res.statusCode, res.body).toBe(201);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: json(res).orderId } });
    expect(payment.paymentAccountId).toBe(a.account!.id);
    expect(FakePixGateway.peek(payment.providerPaymentId!)?.owner).toBe(a.account!.sellerUserId); // quem recebe é o vendedor DA LOJA, nunca a plataforma
    const minutes = (payment.expiresAt!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(28);
    expect(minutes).toBeLessThanOrEqual(30.5);
  });

  it("duas lojas isoladas: cada pedido PIX vai para o vendedor da PRÓPRIA loja e o gateway de uma não enxerga o pagamento da outra", async () => {
    const a = await loja();
    const b = await loja();
    const pa = await prisma.payment.findUniqueOrThrow({ where: { orderId: json(await pedidoPix(a)).orderId } });
    const pb = await prisma.payment.findUniqueOrThrow({ where: { orderId: json(await pedidoPix(b)).orderId } });
    expect(pa.paymentAccountId).toBe(a.account!.id);
    expect(pb.paymentAccountId).toBe(b.account!.id);
    expect(FakePixGateway.peek(pa.providerPaymentId!)?.owner).toBe(a.account!.sellerUserId);
    expect(FakePixGateway.peek(pb.providerPaymentId!)?.owner).toBe(b.account!.sellerUserId);
    expect(a.account!.sellerUserId).not.toBe(b.account!.sellerUserId);
    const { gatewayForAccount } = await import("../src/modules/storePayments/gateway");
    // a conta da loja B não consulta o pagamento da loja A (o provedor responde "não encontrado")
    await expect((await gatewayForAccount(b.account!.id, b.storeId)).getPayment(pa.providerPaymentId!)).rejects.toThrow();
    // e a conta da loja A não pode ser usada como se fosse da B
    await expect(gatewayForAccount(a.account!.id, b.storeId)).rejects.toMatchObject({ code: "PIX_UNAVAILABLE" });
  });

  it("loja SEM conta conectada: 409 PIX_UNAVAILABLE e nenhum pedido; DINHEIRO segue funcionando", async () => {
    const a = await loja({ pix: false });
    const res = await pedidoPix(a);
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe("PIX_UNAVAILABLE");
    expect(await prisma.order.count({ where: { storeId: a.storeId } })).toBe(0);
    const dinheiro = await app.inject({ method: "POST", url: `/stores/${a.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: a.productId, quantity: 1 }], paymentMethod: "DINHEIRO" } });
    expect(dinheiro.statusCode, dinheiro.body).toBe(201);
  });

  it("webhook: aprova pelo pagamento local (conta do pagamento); `?store=` de OUTRA loja ou inexistente nunca altera nada nem vira 4xx", async () => {
    const a = await loja();
    const b = await loja();
    const orderId = json(await pedidoPix(a)).orderId as string;
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    FakePixGateway.approve(payment.providerPaymentId!);

    // dica de OUTRA loja com um pagamento conhecido: a conta usada é a do pagamento local e o resultado é o mesmo (a dica é só dica)
    expect((await assinado(payment.providerPaymentId!, b.storeId)).statusCode).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId } })).status).toBe("APROVADO"); // aprovou pela conta do próprio pagamento
    // loja inexistente: 200 sem efeito
    const outro = await pedidoPix(a);
    const p2 = await prisma.payment.findUniqueOrThrow({ where: { orderId: json(outro).orderId } });
    FakePixGateway.approve(p2.providerPaymentId!);
    expect((await assinado(p2.providerPaymentId!, "naoexisteloja123")).statusCode).toBe(200);
    // replay idempotente
    expect((await assinado(payment.providerPaymentId!)).statusCode).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).awaitingPayment).toBe(false);
  });

  it("webhook ANTES de gravarmos o id do provedor: a dica `?store=` da loja certa liga o pagamento; a dica de OUTRA loja não liga nada", async () => {
    const a = await loja();
    const b = await loja();
    const orderId = json(await pedidoPix(a)).orderId as string;
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    const providerId = payment.providerPaymentId!;
    FakePixGateway.approve(providerId);
    await prisma.payment.update({ where: { id: payment.id }, data: { providerPaymentId: null } }); // a gravação caiu: o id do provedor ainda não está conosco

    // dica da loja ERRADA: consulta com o token da loja B, que não enxerga o pagamento da A ⇒ nada acontece
    expect((await assinado(providerId, b.storeId)).statusCode).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDENTE");
    // dica da loja CERTA: a referência externa liga o pagamento e ele é aprovado
    expect((await assinado(providerId, a.storeId)).statusCode).toBe(200);
    const done = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(done.status).toBe("APROVADO");
    expect(done.providerPaymentId).toBe(providerId);
  });
});
