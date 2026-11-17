import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { mpTokenRefreshJob } from "../src/jobs/mpTokenRefresh";
import { JobRunner } from "../src/jobs/runner";
import { decryptSecret, encryptSecret } from "../src/lib/paymentCrypto";
import { FakePixGateway, gatewayForAccount, gatewayForStore, setGatewayMaker } from "../src/modules/storePayments/gateway";
import { FakeMercadoPagoOAuth, setOAuthProvider } from "../src/modules/storePayments/oauth";
import { PixUnavailableError, REFRESH_RETRY_AFTER_MS, StorePaymentsService } from "../src/modules/storePayments/storePayments.service";
import { resetDb } from "./helpers";

// API-07: a PORTA que o pedido, o webhook e o estorno usam (gateway por loja) e o job de renovação. Tudo fake (CL-13).

const DAY = 24 * 60 * 60 * 1000;
const ctx = (storeId: string, field: string) => ({ storeId, provider: "mercadopago", field });
const silent = { info() {}, warn() {}, error() {} };

describe("gateway por loja", () => {
  let fake: FakeMercadoPagoOAuth;
  let storeA: string;
  let storeB: string;

  async function connected(storeId: string, seller: string, extra: { status?: "CONNECTED" | "NEEDS_RECONNECT" | "DISCONNECTED"; expiresInMs?: number } = {}) {
    const tokens = await fake.exchangeCode({ code: `fake:${seller}`, redirectUri: "x" });
    const status = extra.status ?? "CONNECTED";
    return prisma.paymentAccount.create({
      data: {
        storeId,
        sellerUserId: seller,
        status,
        accessTokenEnc: status === "DISCONNECTED" ? null : encryptSecret(tokens.accessToken, ctx(storeId, "accessToken")),
        refreshTokenEnc: status === "DISCONNECTED" ? null : encryptSecret(tokens.refreshToken, ctx(storeId, "refreshToken")),
        expiresAt: new Date(Date.now() + (extra.expiresInMs ?? 90 * DAY)),
      },
    });
  }
  const charge = { orderId: "pedido-1", amountCents: 4500, description: "Pedido 0001", payerEmail: "c@x.com" };

  beforeEach(async () => {
    fake = new FakeMercadoPagoOAuth();
    setOAuthProvider(fake);
    FakePixGateway.reset();
    await resetDb();
    storeA = (await prisma.store.create({ data: { name: "A", slug: "loja-a-gw", code: "GA1" } })).id;
    storeB = (await prisma.store.create({ data: { name: "B", slug: "loja-b-gw", code: "GB1" } })).id;
  });
  afterEach(async () => {
    setOAuthProvider();
    setGatewayMaker();
    FakePixGateway.reset();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sem conta CONNECTED não há gateway para COBRAR: PixUnavailableError (409 PIX_UNAVAILABLE), nunca o token da plataforma", async () => {
    await expect(gatewayForStore(storeA)).rejects.toThrow(PixUnavailableError);
    await connected(storeA, "vendedor-1", { status: "NEEDS_RECONNECT" });
    await expect(gatewayForStore(storeA)).rejects.toMatchObject({ statusCode: 409, code: "PIX_UNAVAILABLE" });
  });

  it("cria, consulta, cancela e estorna com o gateway da loja; devolve o accountId para gravar em Payment.paymentAccountId", async () => {
    const account = await connected(storeA, "vendedor-1");
    const gateway = await gatewayForStore(storeA);
    expect(gateway).toMatchObject({ accountId: account.id, storeId: storeA });

    const pix = await gateway.createPixPayment({ ...charge, idempotencyKey: "pedido-1:1" });
    expect(pix).toMatchObject({ status: "pending", pixQrCode: expect.stringContaining("000201") });
    expect(await gateway.getPayment(pix.providerPaymentId)).toMatchObject({ status: "pending", externalReference: "pedido-1", amountCents: 4500, currency: "BRL" });

    FakePixGateway.approve(pix.providerPaymentId);
    expect((await gateway.getPayment(pix.providerPaymentId)).status).toBe("approved");
    await gateway.refundPayment(pix.providerPaymentId, "refund-1");
    expect((await gateway.getPayment(pix.providerPaymentId)).status).toBe("refunded");

    const other = await gateway.createPixPayment({ ...charge, orderId: "pedido-2" });
    await gateway.cancelPayment(other.providerPaymentId);
    expect((await gateway.getPayment(other.providerPaymentId)).status).toBe("cancelled");
  });

  it("idempotência: repetir a criação com a mesma chave devolve o MESMO pagamento (queda entre o aceite e a gravação)", async () => {
    await connected(storeA, "vendedor-1");
    const gateway = await gatewayForStore(storeA);
    const first = await gateway.createPixPayment({ ...charge, idempotencyKey: "pedido-1:1" });
    const again = await gateway.createPixPayment({ ...charge, idempotencyKey: "pedido-1:1" });
    expect(again.providerPaymentId).toBe(first.providerPaymentId);
    const next = await gateway.createPixPayment({ ...charge, idempotencyKey: "pedido-1:2" });
    expect(next.providerPaymentId).not.toBe(first.providerPaymentId);
  });

  it("R4 (Nightingale): o gateway de OUTRA loja não enxerga o pagamento — 'não encontrado', sem efeito, sem dizer de quem é", async () => {
    await connected(storeA, "vendedor-1");
    await connected(storeB, "vendedor-2");
    const a = await gatewayForStore(storeA);
    const b = await gatewayForStore(storeB);
    const pix = await a.createPixPayment(charge);
    FakePixGateway.approve(pix.providerPaymentId);
    await expect(b.getPayment(pix.providerPaymentId)).rejects.toThrow("payment not found");
    await expect(b.refundPayment(pix.providerPaymentId)).rejects.toThrow("payment not found");
    await expect(b.cancelPayment(pix.providerPaymentId)).rejects.toThrow("payment not found");
    expect(FakePixGateway.peek(pix.providerPaymentId)).toMatchObject({ status: "approved", refunds: 0 });
  });

  it("gatewayForAccount (webhook, conciliação, estorno): usa a conta que CRIOU o pagamento, mesmo depois de a loja trocar de conta", async () => {
    const first = await connected(storeA, "vendedor-1");
    const pix = await (await gatewayForStore(storeA)).createPixPayment(charge);
    FakePixGateway.approve(pix.providerPaymentId);

    // a loja pede reconexão: PIX novo some, mas o pagamento já criado segue consultável e estornável enquanto o token vale
    await prisma.paymentAccount.update({ where: { id: first.id }, data: { status: "NEEDS_RECONNECT" } });
    await expect(gatewayForStore(storeA)).rejects.toThrow(PixUnavailableError);
    const viaAccount = await gatewayForAccount(first.id, storeA);
    expect((await viaAccount.getPayment(pix.providerPaymentId)).status).toBe("approved");
    await viaAccount.refundPayment(pix.providerPaymentId);
    expect(FakePixGateway.peek(pix.providerPaymentId)?.status).toBe("refunded");

    // a conta com TROCA de vendedor (a antiga fica DISCONNECTED, sem tokens): sem token não há como consultar ⇒ indisponível
    await prisma.paymentAccount.update({ where: { id: first.id }, data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null } });
    await expect(gatewayForAccount(first.id, storeA)).rejects.toThrow(PixUnavailableError);
    await expect(gatewayForAccount("nao-existe", storeA)).rejects.toThrow(PixUnavailableError);
  });

  it("M-2 (cross-tenant): gatewayForAccount com a conta de OUTRA loja é indisponível e não revela que a conta existe", async () => {
    const accountB = await connected(storeB, "vendedor-2");
    await expect(gatewayForAccount(accountB.id, storeA)).rejects.toThrow(PixUnavailableError);
    await expect(gatewayForAccount(accountB.id, "id-qualquer")).rejects.toThrow(PixUnavailableError);
    // mesma mensagem de uma conta inexistente
    const missing = await gatewayForAccount("nao-existe", storeA).catch((e: Error) => e.message);
    const foreign = await gatewayForAccount(accountB.id, storeA).catch((e: Error) => e.message);
    expect(foreign).toBe(missing);
    expect((await gatewayForAccount(accountB.id, storeB)).accountId).toBe(accountB.id);
  });

  it("token vencido ⇒ indisponível (não tenta com token morto); falha do provedor é propagada para quem chamou decidir", async () => {
    const account = await connected(storeA, "vendedor-1", { expiresInMs: -1000 });
    await expect(gatewayForStore(storeA)).rejects.toThrow(PixUnavailableError);
    await prisma.paymentAccount.update({ where: { id: account.id }, data: { expiresAt: new Date(Date.now() + 90 * DAY) } });
    const gateway = await gatewayForStore(storeA);
    FakePixGateway.failNext = new Error("provedor fora do ar");
    await expect(gateway.createPixPayment(charge)).rejects.toThrow("provedor fora do ar");
    expect((await gateway.createPixPayment(charge)).status).toBe("pending"); // a falha era de uma chamada só
  });

  it("a fábrica recebe o token DA conta (decifrado) e o vendedor; nada da plataforma", async () => {
    await connected(storeA, "vendedor-1");
    const seen: Array<{ accessToken: string; owner: string }> = [];
    setGatewayMaker((input) => {
      seen.push(input);
      return new FakePixGateway(input.owner);
    });
    process.env.MP_ACCESS_TOKEN = "TOKEN-DA-PLATAFORMA";
    try {
      await gatewayForStore(storeA);
    } finally {
      delete process.env.MP_ACCESS_TOKEN;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].accessToken).toMatch(/^fake-access-vendedor-1-/);
    expect(seen[0].accessToken).not.toContain("PLATAFORMA");
    expect(seen[0].owner).toBe("vendedor-1");
  });
});

describe("job mp.token.refresh e aviso ao dono", () => {
  let fake: FakeMercadoPagoOAuth;
  let storeId: string;

  const runner = () => {
    const r = new JobRunner({ db: prisma, log: silent });
    r.register(mpTokenRefreshJob);
    return r;
  };
  async function dueAccount(seller = "vendedor-1", expiresInMs = 5 * DAY) {
    const tokens = await fake.exchangeCode({ code: `fake:${seller}`, redirectUri: "x" });
    return prisma.paymentAccount.create({
      data: {
        storeId,
        sellerUserId: seller,
        accessTokenEnc: encryptSecret(tokens.accessToken, ctx(storeId, "accessToken")),
        refreshTokenEnc: encryptSecret(tokens.refreshToken, ctx(storeId, "refreshToken")),
        expiresAt: new Date(Date.now() + expiresInMs),
      },
    });
  }

  beforeEach(async () => {
    fake = new FakeMercadoPagoOAuth();
    setOAuthProvider(fake);
    await resetDb();
    storeId = (await prisma.store.create({ data: { name: "A", slug: "loja-job", code: "JB1" } })).id;
  });
  afterEach(async () => {
    setOAuthProvider();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("renova a conta que vence em < 30 dias e deixa em paz a que tem folga; segunda rodada não repete", async () => {
    const near = await dueAccount("vendedor-1", 5 * DAY);
    await prisma.paymentAccount.update({ where: { id: near.id }, data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null } });
    const due = await dueAccount("vendedor-2", 5 * DAY);
    const result = await runner().run("mp.token.refresh");
    expect(result).toMatchObject({ status: "ok", processed: 1 });
    const after = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: due.id } });
    expect(after.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 100 * DAY);
    expect(await runner().run("mp.token.refresh")).toMatchObject({ status: "ok", processed: 0 });
  });

  it("falha conta no máximo UMA vez por dia (rodar de novo logo em seguida não soma); 3 dias de falha ⇒ NEEDS_RECONNECT", async () => {
    const account = await dueAccount();
    fake.unavailable = true;
    const attempt = async () => (await runner().run("mp.token.refresh")) as { status: string; processed?: number };

    expect(await attempt()).toMatchObject({ processed: 1 });
    expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } })).refreshFailures).toBe(1);
    expect(await attempt()).toMatchObject({ processed: 0 }); // ainda na janela de 20 h
    expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } })).refreshFailures).toBe(1);

    for (const expectedFailures of [2, 3]) {
      await prisma.paymentAccount.update({ where: { id: account.id }, data: { lastRefreshAttemptAt: new Date(Date.now() - REFRESH_RETRY_AFTER_MS - 1000) } });
      await attempt();
      expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } })).refreshFailures).toBe(expectedFailures);
    }
    expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("NEEDS_RECONNECT");
  });

  it("aviso ao dono: avisa UMA vez ao entrar em NEEDS_RECONNECT; falha no envio não derruba a renovação", async () => {
    const revoke = async (accountId: string) => {
      const row = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: accountId } });
      fake.revoked.add(decryptSecret(row.refreshTokenEnc!, ctx(storeId, "refreshToken"))); // o "provedor" passa a recusar o vínculo
    };
    const notify = vi.fn(async (_storeId: string, _event: "needs_reconnect") => {});
    const service = new StorePaymentsService(prisma, () => fake, { log() {}, logStrict: async () => {} }, { now: () => new Date() }, notify);

    const first = await dueAccount("vendedor-1");
    await revoke(first.id);
    expect(await service.refreshAccount(first.id)).toBe("needs_reconnect");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(storeId, "needs_reconnect");
    expect(await service.refreshAccount(first.id)).toBe("skipped"); // já não está CONNECTED: não avisa de novo
    expect(notify).toHaveBeenCalledTimes(1);

    await prisma.paymentAccount.update({ where: { id: first.id }, data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null } });
    const failing = new StorePaymentsService(prisma, () => fake, { log() {}, logStrict: async () => {} }, { now: () => new Date() }, async () => {
      throw new Error("envio falhou");
    });
    const second = await dueAccount("vendedor-2");
    await revoke(second.id);
    await expect(failing.refreshAccount(second.id)).resolves.toBe("needs_reconnect");
    expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("NEEDS_RECONNECT");
  });
});
