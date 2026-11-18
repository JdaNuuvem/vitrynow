// SEC-17: PIX orfao. O provedor criou a cobranca mas o id nunca foi gravado: o job `payment.reconcile` reencontra a cobranca pela
// MESMA chave de idempotencia, anexa o id e cancela/estorna conforme o caso. Provedor 100% fake (FakePixGateway).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { FakePixGateway } from "../src/modules/storePayments/gateway";
import { paymentReconcileJob, ORPHAN_GRACE_MINUTES, ORPHAN_MAX_AGE_HOURS } from "../src/jobs/paymentReconcile";
import { registeredJobs } from "../src/jobs/registry";
import { connectPixAccount, makeApp, registerStore, resetDb } from "./helpers";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const min = (n: number) => new Date(Date.now() - n * 60_000);

describe("SEC-17 - conciliacao de cobranca PIX orfa", () => {
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
  const reconciliar = () => paymentReconcileJob.runOnce({ now: new Date(), db: prisma, log, limit: 50 });

  async function loja() {
    seq += 1;
    const { cookie, response } = await registerStore(app, { slug: `orf-${seq}-${Date.now() % 100000}`, code: `O${seq}`, pix: false });
    const { id: storeId, slug } = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 2000 } })).product.id as string;
    const account = await connectPixAccount(storeId, `vendedor-orf-${seq}`);
    return { storeId, slug, productId, account };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  // Pedido PIX que SAIU no provedor, mas cujo id nunca foi gravado aqui (queda entre o sucesso do provedor e a gravacao).
  async function pedidoOrfao(l: Loja, opts: { idadeMin?: number; cancelado?: boolean } = {}) {
    const res = await app.inject({ method: "POST", url: `/stores/${l.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "PIX" } });
    expect(res.statusCode, res.body).toBe(201);
    const orderId = json(res).orderId as string;
    const antes = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    const providerId = antes.providerPaymentId!;
    await prisma.payment.update({
      where: { id: antes.id },
      data: { providerPaymentId: null, paymentAccountId: null, pixQrCode: null, pixQrCodeBase64: null, expiresAt: null, createdAt: min(opts.idadeMin ?? 10), status: opts.cancelado ? "CANCELADO" : "PENDENTE" },
    });
    if (opts.cancelado) await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELADO", awaitingPayment: false } });
    return { orderId, paymentId: antes.id, providerId };
  }
  const pagamento = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });

  it("registrado no runner", () => {
    expect(registeredJobs.map((j) => j.name)).toContain("payment.reconcile");
  });

  it("orfa de pedido cancelado: reencontra por leitura (referencia do pedido), anexa id/conta e CANCELA no provedor, sem segunda cobranca", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l, { cancelado: true });
    expect(FakePixGateway.peek(o.providerId)?.status).toBe("pending"); // sem o job o cliente ainda poderia pagar esse PIX
    const result = await reconciliar();
    expect(result.processed).toBe(1);
    const p = await pagamento(o.paymentId);
    expect(p.providerPaymentId).toBe(o.providerId);
    expect(p.paymentAccountId).toBe(l.account!.id);
    expect(p.status).toBe("CANCELADO");
    expect(FakePixGateway.peek(o.providerId)?.status).toBe("cancelled");
    expect(FakePixGateway.peek("fake-pix-2")).toBeUndefined();
  });

  it("orfa PAGA antes da conciliacao (pedido cancelado): vira estorno, nunca dinheiro preso", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l, { cancelado: true });
    FakePixGateway.approve(o.providerId);
    await reconciliar();
    const p = await pagamento(o.paymentId);
    expect(p.providerPaymentId).toBe(o.providerId);
    expect(["REEMBOLSADO", "ESTORNO_PENDENTE"]).toContain(p.status);
  });

  it("idempotente: a segunda execucao nao faz nada", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l, { cancelado: true });
    await reconciliar();
    expect((await reconciliar()).processed).toBe(0);
    expect((await pagamento(o.paymentId)).providerPaymentId).toBe(o.providerId);
  });

  it("respeita a folga: chamada possivelmente em andamento nao e tocada", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l, { idadeMin: ORPHAN_GRACE_MINUTES - 2, cancelado: true });
    expect((await reconciliar()).processed).toBe(0);
    expect((await pagamento(o.paymentId)).providerPaymentId).toBeNull();
  });

  it("pedido ainda ATIVO: anexa o id e deixa a expiracao normal agir", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l);
    await reconciliar();
    const p = await pagamento(o.paymentId);
    expect(p.providerPaymentId).toBe(o.providerId);
    expect(p.status).toBe("PENDENTE");
    expect(FakePixGateway.peek(o.providerId)?.status).toBe("pending");
  });

  it("falha do provedor: sem marca de conferido, tenta de novo no proximo ciclo", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l, { cancelado: true });
    FakePixGateway.failNext = new Error("provedor fora do ar");
    await reconciliar();
    expect((await pagamento(o.paymentId)).lastCheckedAt).toBeNull();
    expect((await reconciliar()).processed).toBe(1);
    expect((await pagamento(o.paymentId)).providerPaymentId).toBe(o.providerId);
  });

  it("conta desconectada: nao da para perguntar ao provedor; fica auditado e nao repete", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l, { cancelado: true });
    await prisma.paymentAccount.updateMany({ where: { storeId: l.storeId }, data: { status: "DISCONNECTED" } });
    await reconciliar();
    expect((await pagamento(o.paymentId)).lastCheckedAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 400)); // auditoria assincrona
    expect(await prisma.auditLog.count({ where: { storeId: l.storeId, action: "payment.orphan_unverifiable" } })).toBe(1);
    expect((await reconciliar()).processed).toBe(0);
  });

  it("isolamento entre lojas: cada orfa e resolvida na conta da PROPRIA loja", async () => {
    const a = await loja();
    const b = await loja();
    const oa = await pedidoOrfao(a, { cancelado: true });
    const ob = await pedidoOrfao(b, { cancelado: true });
    await reconciliar();
    expect((await pagamento(oa.paymentId)).paymentAccountId).toBe(a.account!.id);
    expect((await pagamento(ob.paymentId)).paymentAccountId).toBe(b.account!.id);
    expect(FakePixGateway.peek(oa.providerId)?.owner).toBe(a.account!.sellerUserId);
  });

  it("NUNCA cria cobranca: o provedor nao ganha nenhum pagamento novo durante a conciliacao (sem depender de chave de idempotencia)", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l, { cancelado: true });
    (FakePixGateway as unknown as { keys: Map<string, string> }).keys.clear(); // a janela da chave de idempotencia ja "passou": criar de novo geraria cobranca viva nova
    const antes = [...(FakePixGateway as unknown as { ledger: Map<string, unknown> }).ledger.keys()].length;
    await reconciliar();
    expect([...(FakePixGateway as unknown as { ledger: Map<string, unknown> }).ledger.keys()].length).toBe(antes);
    expect((await pagamento(o.paymentId)).providerPaymentId).toBe(o.providerId);
  });

  it("linha mais velha que o limite: nao reconcilia, fica auditada (payment.orphan_unverifiable) e nao repete", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l, { idadeMin: ORPHAN_MAX_AGE_HOURS * 60 + 30, cancelado: true });
    await reconciliar();
    const p = await pagamento(o.paymentId);
    expect([p.providerPaymentId, p.lastCheckedAt === null]).toEqual([null, false]);
    expect(FakePixGateway.peek(o.providerId)?.status).toBe("pending"); // intocada: suporte decide
    await new Promise((r) => setTimeout(r, 400)); // auditoria assincrona
    expect(await prisma.auditLog.count({ where: { storeId: l.storeId, action: "payment.orphan_unverifiable" } })).toBe(1);
    expect((await reconciliar()).processed).toBe(0);
  });

  it("provedor sem cobranca para o pedido: auditado como nao encontrado, sem criar nada e sem repetir", async () => {
    const l = await loja();
    const o = await pedidoOrfao(l, { cancelado: true });
    FakePixGateway.reset(); // a cobranca nunca chegou ao provedor
    await reconciliar();
    expect((await pagamento(o.paymentId)).providerPaymentId).toBeNull();
    await new Promise((r) => setTimeout(r, 400)); // auditoria assincrona
    expect(await prisma.auditLog.count({ where: { storeId: l.storeId, action: "payment.orphan_not_found" } })).toBe(1);
    expect((await reconciliar()).processed).toBe(0);
  });
});
