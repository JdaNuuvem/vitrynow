import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { techCleanupJob } from "../src/jobs/techCleanup";
import { JobRunner } from "../src/jobs/runner";
import { activateSubscription } from "../src/lib/subscription";
import { currentKey, decryptSecret, encryptSecret } from "../src/lib/paymentCrypto";
import { redactLogUrl } from "../src/lib/logRedaction";
import { FakeMercadoPagoOAuth, OAuthError, RealMercadoPagoOAuth, assertPaymentsBootConfig, oauthProvider, setOAuthProvider } from "../src/modules/storePayments/oauth";
import { MAX_REFRESH_FAILURES, PixUnavailableError, StorePaymentsService, maskSeller } from "../src/modules/storePayments/storePayments.service";
import { storePaymentsService } from "../src/modules/storePayments/storePayments.module";
import { login, makeApp, registerStore, resetDb } from "./helpers";

// API-07 (ADR-0001): PIX por loja, SEM credencial real — tudo contra o FakeMercadoPagoOAuth.
// Critérios da Nightingale: token nunca em texto, `state` só como hash e de uso único, AAD por loja/campo,
// renovação em via única, conta anterior no histórico sem tokens, fake nunca em produção.

const DAY = 24 * 60 * 60 * 1000;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("PIX por loja — conexão, estado e desconexão (HTTP)", () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  let storeId: string;
  let fake: FakeMercadoPagoOAuth;

  beforeEach(async () => {
    fake = new FakeMercadoPagoOAuth();
    setOAuthProvider(fake);
    app = makeApp();
    await app.ready();
    const registered = await registerStore(app, { slug: "loja-pix", code: "PX1" });
    cookie = registered.cookie!;
    storeId = JSON.parse(registered.response.body).store.id;
  });
  afterEach(async () => {
    setOAuthProvider();
    delete process.env.MFA_ENFORCED;
    await app.close();
    await resetDb();
    await prisma.paymentOAuthState.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  const post = (url: string, as = cookie, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url, headers: { cookie: as, ...headers }, payload: payload as never });
  const get = (url: string, as = cookie) => app.inject({ method: "GET", url, headers: { cookie: as } });
  const startConnect = async (as = cookie) => {
    const response = await post("/api/store/payments/mercadopago/connect", as);
    expect(response.statusCode, response.body).toBe(200);
    const url = new URL(json(response).authorizationUrl);
    return { state: url.searchParams.get("state")!, code: url.searchParams.get("code")!, url };
  };
  const callback = (code: string, state: string, as = cookie) => get(`/api/store/payments/mercadopago/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, as);
  const connect = async (code = "fake:vendedor-1", as = cookie) => {
    const { state } = await startConnect(as);
    return callback(code, state, as);
  };
  const menuStore = async () => json(await app.inject({ method: "GET", url: "/stores/loja-pix/menu" })).store;
  const pixOrder = (method = "PIX") =>
    app.inject({ method: "POST", url: "/stores/loja-pix/orders", payload: { type: "BALCAO", paymentMethod: method, items: [{ productId: "x", quantity: 1 }] } });

  it("sem conta: o painel vê NOT_CONNECTED, o cardápio diz pixAvailable=false e o servidor recusa PIX (409 PIX_UNAVAILABLE)", async () => {
    expect(json(await get("/api/store/payments"))).toEqual({
      mercadopago: { status: "NOT_CONNECTED", sellerMasked: null, connectedAt: null, expiresAt: null },
      pixAvailable: false,
    });
    expect((await menuStore()).payment).toEqual({ pixAvailable: false });
    const refused = await pixOrder("PIX");
    expect(refused.statusCode).toBe(409);
    expect(json(refused)).toMatchObject({ code: "PIX_UNAVAILABLE" });
    expect(await prisma.order.count()).toBe(0);
    // outra forma de pagamento não é afetada: chega até a validação do pedido (produto inexistente ⇒ 4xx do pedido, não PIX_UNAVAILABLE)
    expect(json(await pixOrder("DINHEIRO")).code).not.toBe("PIX_UNAVAILABLE");
  });

  it("conectar ponta a ponta: redireciona ao painel, grava CIFRADO, mostra vendedor mascarado e liga o PIX no cardápio", async () => {
    const { state, code, url } = await startConnect();
    expect(url.pathname).toBe("/api/store/payments/mercadopago/callback"); // redirect_uri fixo por configuração
    expect(state.length).toBeGreaterThanOrEqual(22); // 128 bits em base64url
    const row = await prisma.paymentOAuthState.findFirstOrThrow();
    expect(row.stateHash).toBe(sha256(state)); // só o hash fica no banco
    expect(JSON.stringify(row)).not.toContain(state);

    const response = await callback(code, state);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/\/dashboard\/pagamentos\?mp=ok$/);
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cache-control"]).toBe("no-store");

    const account = await prisma.paymentAccount.findFirstOrThrow();
    expect(account).toMatchObject({ storeId, status: "CONNECTED", sellerUserId: "vendedor-1" });
    expect(account.accessTokenEnc).toMatch(/^v1\.v1\./);
    expect(JSON.stringify(account)).not.toContain("fake-access");
    expect(JSON.stringify(account)).not.toContain("fake-refresh");
    expect(decryptSecret(account.accessTokenEnc!, { storeId, provider: "mercadopago", field: "accessToken" })).toMatch(/^fake-access-vendedor-1-/);

    const view = json(await get("/api/store/payments"));
    expect(view.pixAvailable).toBe(true);
    expect(view.mercadopago).toMatchObject({ status: "CONNECTED", sellerMasked: maskSeller("vendedor-1") });
    expect(JSON.stringify(view)).not.toMatch(/fake-|access_token|refresh_token|accessToken|refreshToken|vendedor-1/);
    expect((await menuStore()).payment).toEqual({ pixAvailable: true });
    expect(json(await pixOrder("PIX")).code).not.toBe("PIX_UNAVAILABLE"); // passou do portão; a rota do pedido decide o resto
  });

  it("state: uso único (reuso falha), vencido (10 min) falha, inventado falha — sempre redirecionando com motivo fechado e sem conta nova", async () => {
    const { state, code } = await startConnect();
    expect((await callback(code, state)).headers.location).toContain("mp=ok");
    const reuse = await callback(code, state);
    expect(reuse.statusCode).toBe(302);
    expect(reuse.headers.location).toContain("mp=erro&motivo=OAUTH_STATE_INVALID");

    const second = await startConnect();
    await prisma.paymentOAuthState.updateMany({ where: { stateHash: sha256(second.state) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await callback(second.code, second.state)).headers.location).toContain("OAUTH_STATE_INVALID");

    expect((await callback("fake:vendedor-9", "inventado")).headers.location).toContain("OAUTH_STATE_INVALID");
    expect((await get("/api/store/payments/mercadopago/callback")).headers.location).toContain("OAUTH_STATE_INVALID"); // sem parâmetros
    expect(await prisma.paymentAccount.count()).toBe(1);
  });

  it("state preso à SESSÃO que iniciou (linking CSRF): outro login do mesmo dono não consegue concluir", async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { storeId } });
    const { state, code } = await startConnect();
    const otherSession = (await login(app, owner.email, "senha123")).cookie!;
    expect(otherSession).not.toBe(cookie);
    const attempt = await callback(code, state, otherSession);
    expect(attempt.headers.location).toContain("OAUTH_STATE_INVALID");
    expect(await prisma.paymentAccount.count()).toBe(0);
    // e o state NÃO foi gasto pela tentativa errada: a sessão certa ainda conclui
    expect((await callback(code, state)).headers.location).toContain("mp=ok");
  });

  it("state de OUTRA loja não conecta esta loja", async () => {
    const other = await registerStore(app, { slug: "outra-pix", code: "PX2" });
    const foreign = await startConnect(other.cookie!);
    const attempt = await callback(foreign.code, foreign.state);
    expect(attempt.headers.location).toContain("OAUTH_STATE_INVALID");
    expect(await prisma.paymentAccount.count()).toBe(0);
  });

  it("código recusado pelo provedor ⇒ erro neutro e nada gravado; provedor fora do ar ⇒ motivo próprio", async () => {
    expect((await connect("fake-invalid")).headers.location).toContain("OAUTH_CODE_INVALID");
    fake.unavailable = true;
    expect((await connect("fake:vendedor-1")).headers.location).toContain("PAYMENT_PROVIDER_UNAVAILABLE");
    expect(await prisma.paymentAccount.count()).toBe(0);
  });

  it("reconectar com OUTRO vendedor: a conta anterior vira DISCONNECTED SEM tokens e fica no histórico; só uma ativa", async () => {
    await connect("fake:vendedor-1");
    const first = await prisma.paymentAccount.findFirstOrThrow();
    expect((await connect("fake:vendedor-2")).headers.location).toContain("mp=ok");
    const accounts = await prisma.paymentAccount.findMany({ orderBy: { connectedAt: "asc" } });
    expect(accounts.map((a) => [a.sellerUserId, a.status])).toEqual([["vendedor-1", "DISCONNECTED"], ["vendedor-2", "CONNECTED"]]);
    expect(accounts[0].id).toBe(first.id);
    expect(accounts[0]).toMatchObject({ accessTokenEnc: null, refreshTokenEnc: null });
    expect(accounts[0].disconnectedAt).not.toBeNull();
  });

  it("reconectar quando a conta está em NEEDS_RECONNECT: a antiga é desconectada na mesma transação e a nova entra (o índice parcial não bloqueia)", async () => {
    await connect("fake:vendedor-1");
    await prisma.paymentAccount.updateMany({ data: { status: "NEEDS_RECONNECT" } });
    expect((await connect("fake:vendedor-1")).headers.location).toContain("mp=ok"); // mesmo vendedor reconectando
    const accounts = await prisma.paymentAccount.findMany({ orderBy: { connectedAt: "asc" } });
    expect(accounts.map((a) => a.status)).toEqual(["DISCONNECTED", "CONNECTED"]);
    expect(accounts[0].accessTokenEnc).toBeNull();
  });

  it("o MESMO vendedor em duas lojas: a segunda é recusada com mensagem genérica (MP_ACCOUNT_IN_USE) e a primeira segue intacta", async () => {
    await connect("fake:vendedor-1");
    const other = await registerStore(app, { slug: "outra-pix", code: "PX2" });
    const attempt = await connect("fake:vendedor-1", other.cookie!);
    expect(attempt.headers.location).toContain("MP_ACCOUNT_IN_USE");
    expect(await prisma.paymentAccount.count({ where: { status: "CONNECTED" } })).toBe(1);
    expect((await prisma.paymentAccount.findFirstOrThrow({ where: { status: "CONNECTED" } })).storeId).toBe(storeId);
  });

  it("só o OWNER: sem login 401; STAFF 403 em todas as rotas", async () => {
    for (const [method, url] of [["GET", "/api/store/payments"], ["POST", "/api/store/payments/mercadopago/connect"], ["GET", "/api/store/payments/mercadopago/callback"], ["POST", "/api/store/payments/mercadopago/disconnect"]] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
    await activateSubscription({ subscriptionId: (await prisma.subscription.findFirstOrThrow()).id, planCode: "PRO" });
    expect((await post("/api/users", cookie, { email: "staff-px@teste.com", password: "senha-forte-123" })).statusCode).toBe(201);
    const staff = (await login(app, "staff-px@teste.com", "senha-forte-123")).cookie!;
    for (const [method, url] of [["GET", "/api/store/payments"], ["POST", "/api/store/payments/mercadopago/connect"], ["POST", "/api/store/payments/mercadopago/disconnect"]] as const) {
      expect((await app.inject({ method, url, headers: { cookie: staff } })).statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("com MFA obrigatório, conectar e desconectar exigem a prova (403 MFA_REQUIRED)", async () => {
    process.env.MFA_ENFORCED = "true";
    const connectRes = await post("/api/store/payments/mercadopago/connect");
    expect(connectRes.statusCode).toBe(403);
    expect(json(connectRes)).toMatchObject({ code: "MFA_REQUIRED", purpose: "connect_payment" });
    expect(json(await post("/api/store/payments/mercadopago/disconnect")).purpose).toBe("disconnect_payment");
  });

  it("desconectar APAGA os tokens (não só marca), desliga o PIX e audita sem token; sem conta é 404", async () => {
    expect((await post("/api/store/payments/mercadopago/disconnect")).statusCode).toBe(404);
    await connect();
    expect((await post("/api/store/payments/mercadopago/disconnect")).statusCode).toBe(200);
    const account = await prisma.paymentAccount.findFirstOrThrow();
    expect(account).toMatchObject({ status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null });
    expect((await menuStore()).payment).toEqual({ pixAvailable: false });
    expect(json(await get("/api/store/payments")).mercadopago.status).toBe("NOT_CONNECTED");

    let rows: Array<{ action: string; metadata: unknown }> = [];
    for (let i = 0; i < 50 && rows.length < 3; i++) {
      rows = await prisma.auditLog.findMany({ where: { action: { startsWith: "payment_account." } }, orderBy: { createdAt: "asc" } });
      if (rows.length < 3) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(rows.map((r) => r.action)).toEqual(["payment_account.connect_start", "payment_account.connect", "payment_account.disconnect"]);
    expect(JSON.stringify(rows)).not.toMatch(/fake-|vendedor-1|state|"sid"/); // nem token, nem vendedor inteiro, nem a sessão
  });

  it("P-2: desconectar também é BLOQUEADO com PIX ainda PENDENTE (QR vigente): o cliente poderia pagar depois de o token sumir", async () => {
    await connect();
    const account = await prisma.paymentAccount.findFirstOrThrow();
    const order = await prisma.order.create({ data: { storeId, code: "0002", type: "BALCAO", status: "PENDENTE", customerName: "C", totalCents: 1000, paymentMethod: "PIX" } });
    await prisma.payment.create({ data: { orderId: order.id, amountCents: 1000, status: "PENDENTE", paymentAccountId: account.id } });
    const blocked = await post("/api/store/payments/mercadopago/disconnect");
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked)).toMatchObject({ code: "MP_HAS_PENDING_PAYMENTS", details: { pixPending: 1, refundPending: 0 } });
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELADO" } });
    expect((await post("/api/store/payments/mercadopago/disconnect")).statusCode).toBe(200);
  });

  it("modo off (PIX desligado): conectar é 409 PAYMENTS_DISABLED e o cardápio não oferece PIX", async () => {
    setOAuthProvider();
    const saved = process.env.MP_OAUTH_MODE;
    process.env.MP_OAUTH_MODE = "off";
    try {
      const response = await post("/api/store/payments/mercadopago/connect");
      expect(response.statusCode).toBe(409);
      expect(json(response).code).toBe("PAYMENTS_DISABLED");
      expect((await menuStore()).payment).toEqual({ pixAvailable: false });
    } finally {
      if (saved === undefined) delete process.env.MP_OAUTH_MODE;
      else process.env.MP_OAUTH_MODE = saved;
    }
  });

  it("desconectar é BLOQUEADO enquanto houver PIX pago de pedido em andamento (D1-9); libera quando o pedido encerra", async () => {
    await connect();
    const account = await prisma.paymentAccount.findFirstOrThrow();
    const order = await prisma.order.create({
      data: { storeId, code: "0001", type: "BALCAO", status: "CONFIRMADO", customerName: "C", totalCents: 1000, paymentMethod: "PIX" },
    });
    await prisma.payment.create({ data: { orderId: order.id, amountCents: 1000, status: "APROVADO", paymentAccountId: account.id } });
    const blocked = await post("/api/store/payments/mercadopago/disconnect");
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked)).toMatchObject({ code: "MP_HAS_PENDING_PAYMENTS", details: { pixPending: 1, refundPending: 0 } });
    expect((await prisma.paymentAccount.findFirstOrThrow()).status).toBe("CONNECTED");

    await prisma.order.update({ where: { id: order.id }, data: { status: "CONCLUIDO" } });
    expect((await post("/api/store/payments/mercadopago/disconnect")).statusCode).toBe(200);
  });

  async function pendingOrder(accountId: string, status: "PENDENTE" | "APROVADO" | "ESTORNO_PENDENTE", orderStatus = "PENDENTE", code = "0100") {
    const order = await prisma.order.create({ data: { storeId, code, type: "BALCAO", status: orderStatus as never, customerName: "C", totalCents: 1000, paymentMethod: "PIX" } });
    return prisma.payment.create({ data: { orderId: order.id, amountCents: 1000, status, paymentAccountId: accountId } });
  }

  it("RN-B1-15: o bloqueio traz o código MP_HAS_PENDING_PAYMENTS, os contadores e a frase certa (1, N e estorno pendente) e nada é apagado", async () => {
    await connect();
    const account = await prisma.paymentAccount.findFirstOrThrow();
    const message = async () => json(await post("/api/store/payments/mercadopago/disconnect"));

    await pendingOrder(account.id, "PENDENTE", "PENDENTE", "0101");
    expect(await message()).toMatchObject({ code: "MP_HAS_PENDING_PAYMENTS", error: "Há 1 PIX em andamento. Aguarde o pagamento ou cancele o pedido.", details: { pixPending: 1, refundPending: 0 } });
    await pendingOrder(account.id, "APROVADO", "CONFIRMADO", "0102");
    expect(await message()).toMatchObject({ error: "Há 2 PIX em andamento. Aguarde o pagamento ou cancele os pedidos.", details: { pixPending: 2 } });
    await pendingOrder(account.id, "ESTORNO_PENDENTE", "CONFIRMADO", "0103");
    expect(await message()).toMatchObject({ error: "Há um estorno em andamento. Aguarde terminar para desconectar.", details: { refundPending: 1 } });

    const kept = await prisma.paymentAccount.findFirstOrThrow();
    expect(kept.status).toBe("CONNECTED");
    expect(kept.accessTokenEnc).not.toBeNull(); // nada apagado no bloqueio
  });

  it("reconectar a MESMA conta com PIX pendente passa e os pagamentos antigos passam para a conta nova (o token novo os confere)", async () => {
    await connect("fake:vendedor-1");
    const old = await prisma.paymentAccount.findFirstOrThrow();
    const payment = await pendingOrder(old.id, "PENDENTE");
    expect((await connect("fake:vendedor-1")).headers.location).toContain("mp=ok");
    const current = await prisma.paymentAccount.findFirstOrThrow({ where: { status: "CONNECTED" } });
    expect(current.id).not.toBe(old.id);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).paymentAccountId).toBe(current.id);
  });

  it("trocar por OUTRA conta com PIX ou estorno pendente é BLOQUEADO (a conta antiga segue ativa); sem pendência a troca passa", async () => {
    await connect("fake:vendedor-1");
    const old = await prisma.paymentAccount.findFirstOrThrow();
    const payment = await pendingOrder(old.id, "ESTORNO_PENDENTE", "CONFIRMADO");
    const blocked = await connect("fake:vendedor-2");
    expect(blocked.headers.location).toContain("MP_HAS_PENDING_PAYMENTS");
    expect((await prisma.paymentAccount.findMany()).map((a) => [a.sellerUserId, a.status])).toEqual([["vendedor-1", "CONNECTED"]]);

    await prisma.payment.update({ where: { id: payment.id }, data: { status: "REEMBOLSADO" } });
    expect((await connect("fake:vendedor-2")).headers.location).toContain("mp=ok");
  });

  it("N-1: o rastro é ATÔMICO — se o banco recusar o registro de auditoria, conectar e desconectar NÃO acontecem", async () => {
    const block = (action: string) => prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "zz_bloqueia_auditoria" CHECK ("action" <> '${action}')`);
    const unblock = () => prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "zz_bloqueia_auditoria"`);
    try {
      await block("payment_account.connect");
      expect((await connect()).headers.location).toContain("mp=erro"); // erro, e...
      expect(await prisma.paymentAccount.count()).toBe(0); // ...nenhuma conta ficou sem rastro
      await unblock();

      expect((await connect()).headers.location).toContain("mp=ok");
      await block("payment_account.disconnect");
      expect((await post("/api/store/payments/mercadopago/disconnect")).statusCode).toBe(500);
      const still = await prisma.paymentAccount.findFirstOrThrow();
      expect(still.status).toBe("CONNECTED"); // os tokens NÃO foram apagados sem rastro
      expect(still.accessTokenEnc).not.toBeNull();
    } finally {
      await unblock();
    }
  });

  it("tech.cleanup remove o `state` vencido e mantém o válido", async () => {
    await startConnect();
    await prisma.paymentOAuthState.create({ data: { storeId, userId: "u", sid: "s", stateHash: "h-vencido", expiresAt: new Date(Date.now() - 3 * DAY) } });
    const runner = new JobRunner({ db: prisma, log: { info() {}, warn() {}, error() {} } });
    runner.register(techCleanupJob);
    expect(await runner.run("tech.cleanup")).toMatchObject({ status: "ok", processed: 1 });
    expect(await prisma.paymentOAuthState.count()).toBe(1);
  });
});

describe("conta de pagamento — token e renovação (serviço)", () => {
  let fake: FakeMercadoPagoOAuth;
  let clock: { current: Date; now(): Date };
  let service: StorePaymentsService;
  let storeA: string;
  let storeB: string;

  const ctx = (storeId: string, field: string) => ({ storeId, provider: "mercadopago", field });
  async function accountFor(storeId: string, seller: string, expiresInMs: number, extra: Partial<{ failures: number }> = {}) {
    const tokens = await fake.exchangeCode({ code: `fake:${seller}`, redirectUri: "x" });
    return prisma.paymentAccount.create({
      data: {
        storeId,
        sellerUserId: seller,
        accessTokenEnc: encryptSecret(tokens.accessToken, ctx(storeId, "accessToken")),
        refreshTokenEnc: encryptSecret(tokens.refreshToken, ctx(storeId, "refreshToken")),
        expiresAt: new Date(clock.current.getTime() + expiresInMs),
        refreshFailures: extra.failures ?? 0,
      },
    });
  }

  beforeEach(async () => {
    clock = { current: new Date("2026-11-17T12:00:00Z"), now() { return this.current; } };
    fake = new FakeMercadoPagoOAuth(() => clock.current);
    service = new StorePaymentsService(prisma, () => fake, { log() {}, logStrict: async () => {} }, clock); // auditoria silenciosa: a loja some no fim de cada teste
    await resetDb();
    storeA = (await prisma.store.create({ data: { name: "A", slug: "loja-a-svc", code: "SA1" } })).id;
    storeB = (await prisma.store.create({ data: { name: "B", slug: "loja-b-svc", code: "SB1" } })).id;
  });
  afterEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("renova quando faltam < 30 dias: grava o par NOVO cifrado, o refresh_token rotativo antigo deixa de valer e zera as falhas", async () => {
    const account = await accountFor(storeA, "vendedor-1", 10 * DAY, { failures: 2 });
    const oldRefresh = decryptSecret(account.refreshTokenEnc!, ctx(storeA, "refreshToken"));
    expect(await service.refreshAccount(account.id)).toBe("refreshed");
    const after = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } });
    const newRefresh = decryptSecret(after.refreshTokenEnc!, ctx(storeA, "refreshToken"));
    expect(newRefresh).not.toBe(oldRefresh);
    expect(fake.revoked.has(oldRefresh)).toBe(true);
    expect(after.expiresAt!.getTime()).toBeGreaterThan(clock.current.getTime() + 100 * DAY);
    expect(after).toMatchObject({ refreshFailures: 0, lastError: null, status: "CONNECTED" });
    expect(after.lastRefreshAt).toEqual(clock.current);
  });

  it("não renova quem ainda tem folga (≥ 30 dias) nem conta fora de cena", async () => {
    const fresh = await accountFor(storeA, "vendedor-1", 90 * DAY);
    expect(await service.refreshAccount(fresh.id)).toBe("skipped");
    await prisma.paymentAccount.update({ where: { id: fresh.id }, data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null } });
    expect(await service.refreshAccount(fresh.id)).toBe("skipped");
    expect(await service.refreshAccount("nao-existe")).toBe("skipped");
    expect((await service.dueForRefresh(clock.current, 10)).map((a) => a.id)).toEqual([]);
  });

  it("dueForRefresh lista só contas CONNECTED a vencer, mais urgentes primeiro", async () => {
    const soon = await accountFor(storeA, "vendedor-1", 5 * DAY);
    const sooner = await accountFor(storeB, "vendedor-2", 1 * DAY);
    expect((await service.dueForRefresh(clock.current, 10)).map((a) => a.id)).toEqual([sooner.id, soon.id]);
    await prisma.paymentAccount.update({ where: { id: soon.id }, data: { status: "NEEDS_RECONNECT" } });
    expect((await service.dueForRefresh(clock.current, 10)).map((a) => a.id)).toEqual([sooner.id]);
  });

  it("falha transitória NÃO apaga o token antigo ainda válido; na 3ª falha seguida vira NEEDS_RECONNECT e o PIX some", async () => {
    const account = await accountFor(storeA, "vendedor-1", 5 * DAY);
    const original = account.accessTokenEnc;
    fake.unavailable = true;
    for (let i = 1; i < MAX_REFRESH_FAILURES; i++) {
      expect(await service.refreshAccount(account.id)).toBe("failed");
      const row = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(row).toMatchObject({ status: "CONNECTED", refreshFailures: i, accessTokenEnc: original });
    }
    expect(await service.pixAvailable(storeA)).toBe(true); // ainda cobra: o token antigo vale
    expect(await service.refreshAccount(account.id)).toBe("needs_reconnect");
    const row = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.status).toBe("NEEDS_RECONNECT");
    expect(row.lastError).toBe("falha ao renovar o token");
    expect(row.accessTokenEnc).toBe(original);
    expect(await service.pixAvailable(storeA)).toBe(false);
  });

  it("vínculo revogado pelo provedor: NEEDS_RECONNECT na hora (sem esperar 3 falhas); a mensagem de erro não carrega token", async () => {
    const account = await accountFor(storeA, "vendedor-1", 5 * DAY);
    fake.revoked.add(decryptSecret(account.refreshTokenEnc!, ctx(storeA, "refreshToken")));
    expect(await service.refreshAccount(account.id)).toBe("needs_reconnect");
    const row = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.lastError).toBe("vínculo revogado pelo provedor");
    expect(JSON.stringify(row)).not.toContain("fake-refresh-vendedor-1-1.");
  });

  it("o provedor devolve OUTRO vendedor na renovação: recusado como revogado (nunca troca o dono do dinheiro)", async () => {
    const account = await accountFor(storeA, "vendedor-1", 5 * DAY);
    const original = fake.refresh.bind(fake);
    fake.refresh = async (token) => ({ ...(await original(token)), sellerUserId: "outro-vendedor" });
    expect(await service.refreshAccount(account.id)).toBe("needs_reconnect");
    expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } })).sellerUserId).toBe("vendedor-1");
  });

  it("8 renovações simultâneas da MESMA conta: exatamente 1 chega ao provedor (via única, D1-4)", async () => {
    const account = await accountFor(storeA, "vendedor-1", 5 * DAY);
    let providerCalls = 0;
    const original = fake.refresh.bind(fake);
    fake.refresh = async (token) => {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 80)); // dá tempo das outras chegarem à trava
      return original(token);
    };
    const results = await Promise.all(Array.from({ length: 8 }, () => service.refreshAccount(account.id)));
    expect(results.filter((r) => r === "refreshed")).toHaveLength(1);
    expect(results.filter((r) => r === "skipped")).toHaveLength(7);
    expect(providerCalls).toBe(1);
    expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } })).refreshFailures).toBe(0);
  });

  it("N-1: needs_reconnect grava o rastro NA MESMA transação da marcação; se o rastro falhar, nada muda e a próxima rodada tenta de novo", async () => {
    const account = await accountFor(storeA, "vendedor-1", 5 * DAY);
    fake.revoked.add(decryptSecret(account.refreshTokenEnc!, ctx(storeA, "refreshToken")));
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "zz_bloqueia_auditoria" CHECK ("action" <> 'payment_account.needs_reconnect')`);
    try {
      await expect(service.refreshAccount(account.id)).rejects.toThrow();
      expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("CONNECTED");
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "zz_bloqueia_auditoria"`);
    }
    expect(await service.refreshAccount(account.id)).toBe("needs_reconnect");
    expect(await prisma.auditLog.count({ where: { action: "payment_account.needs_reconnect", targetId: account.id } })).toBe(1);
  });

  it("accessTokenFor: devolve o token da conta; vencido, desconectado ou sem token ⇒ PixUnavailableError (NUNCA o token da plataforma)", async () => {
    const account = await accountFor(storeA, "vendedor-1", 90 * DAY);
    expect(await service.accessTokenFor(account)).toMatch(/^fake-access-vendedor-1-/);
    await expect(service.accessTokenFor({ ...account, expiresAt: new Date(clock.current.getTime() - 1000) })).rejects.toThrow(PixUnavailableError);
    await expect(service.accessTokenFor({ ...account, accessTokenEnc: null })).rejects.toThrow(PixUnavailableError);
  });

  it("AAD no banco: copiar o texto cifrado da loja A para a conta da loja B não decifra", async () => {
    const a = await accountFor(storeA, "vendedor-1", 90 * DAY);
    const b = await accountFor(storeB, "vendedor-2", 90 * DAY);
    const swapped = await prisma.paymentAccount.update({ where: { id: b.id }, data: { accessTokenEnc: a.accessTokenEnc } });
    await expect(service.accessTokenFor(swapped)).rejects.toThrow();
    // e entre CAMPOS da mesma loja
    const sameStore = { ...a, accessTokenEnc: a.refreshTokenEnc };
    await expect(service.accessTokenFor(sameStore)).rejects.toThrow();
  });

  it("accountForCharge: só CONNECTED cobra; NEEDS_RECONNECT e DISCONNECTED ⇒ PIX_UNAVAILABLE", async () => {
    await expect(service.accountForCharge(storeA)).rejects.toMatchObject({ statusCode: 409, code: "PIX_UNAVAILABLE" });
    const account = await accountFor(storeA, "vendedor-1", 90 * DAY);
    expect((await service.accountForCharge(storeA)).id).toBe(account.id);
    await prisma.paymentAccount.update({ where: { id: account.id }, data: { status: "NEEDS_RECONNECT" } });
    await expect(service.accountForCharge(storeA)).rejects.toThrow(PixUnavailableError);
  });

  it("o índice parcial do banco recusa duas contas ativas na mesma loja e o mesmo vendedor em duas lojas", async () => {
    await accountFor(storeA, "vendedor-1", 90 * DAY);
    await expect(accountFor(storeA, "vendedor-2", 90 * DAY)).rejects.toThrow();
    await expect(accountFor(storeB, "vendedor-1", 90 * DAY)).rejects.toThrow();
    await prisma.paymentAccount.updateMany({ data: { status: "DISCONNECTED" } });
    await expect(accountFor(storeA, "vendedor-3", 90 * DAY)).resolves.toBeTruthy(); // histórico não bloqueia
  });
});

describe("OAuth — seleção por ambiente e cliente real (sem credencial)", () => {
  afterEach(() => setOAuthProvider());

  it("o FAKE nunca sobe em produção; real exige as credenciais; o padrão fora de produção é o fake", () => {
    expect(() => oauthProvider({ NODE_ENV: "production" })).toThrow(/MP_OAUTH_MODE não configurado/);
    expect(() => oauthProvider({ MP_OAUTH_MODE: "real" })).toThrow(/MP_CLIENT_ID/);
    expect(oauthProvider({ NODE_ENV: "development" }).mode).toBe("fake");
    expect(oauthProvider({ NODE_ENV: "test" }).mode).toBe("fake");
    expect(() => oauthProvider({})).toThrow(/MP_OAUTH_MODE não configurado/); // NODE_ENV AUSENTE conta como produção (SEC-22)
    expect(oauthProvider({ MP_OAUTH_MODE: "real", MP_CLIENT_ID: "1", MP_CLIENT_SECRET: "s", NODE_ENV: "production" }).mode).toBe("real");
  });

  it("o fake recusa código inválido, revoga o refresh_token rotativo e simula provedor fora do ar", async () => {
    const fake = new FakeMercadoPagoOAuth();
    await expect(fake.exchangeCode({ code: "lixo", redirectUri: "x" })).rejects.toMatchObject({ kind: "invalid_code" });
    const tokens = await fake.exchangeCode({ code: "fake:v-1", redirectUri: "x" });
    expect(tokens.sellerUserId).toBe("v-1");
    const next = await fake.refresh(tokens.refreshToken);
    expect(next.sellerUserId).toBe("v-1");
    await expect(fake.refresh(tokens.refreshToken)).rejects.toMatchObject({ kind: "revoked" }); // o antigo já foi usado
    fake.unavailable = true;
    await expect(fake.refresh(next.refreshToken)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("real (NÃO VERIFICADO no sandbox): monta a URL e as chamadas como na documentação; erro nunca carrega o corpo do provedor", async () => {
    const calls: Array<{ url: string; body: Record<string, string> }> = [];
    let status = 200;
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 100, user_id: 123, detalhe: "SEGREDO-DO-PROVEDOR" }), { status });
    }) as unknown as typeof fetch;
    const real = new RealMercadoPagoOAuth({ clientId: "cid", clientSecret: "csecret" }, impl);

    const authorize = new URL(real.authorizationUrl({ state: "st", redirectUri: "https://api.exemplo/cb" }));
    expect(authorize.origin + authorize.pathname).toBe("https://auth.mercadopago.com.br/authorization");
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({ client_id: "cid", response_type: "code", platform_id: "mp", state: "st", redirect_uri: "https://api.exemplo/cb" });
    expect(authorize.toString()).not.toContain("csecret");

    expect(await real.exchangeCode({ code: "c", redirectUri: "https://api.exemplo/cb" })).toMatchObject({ accessToken: "AT", refreshToken: "RT", sellerUserId: "123" });
    expect(calls[0]).toMatchObject({ url: "https://api.mercadopago.com/oauth/token", body: { grant_type: "authorization_code", code: "c", client_id: "cid" } });
    await real.refresh("RT");
    expect(calls[1].body).toMatchObject({ grant_type: "refresh_token", refresh_token: "RT" });

    status = 400;
    const error = await real.refresh("RT").catch((e) => e as OAuthError);
    expect(error).toMatchObject({ kind: "revoked" });
    expect(String((error as Error).message)).not.toContain("SEGREDO-DO-PROVEDOR");
    status = 503;
    await expect(real.exchangeCode({ code: "c", redirectUri: "x" })).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("M-1: configuração de pagamentos no boot", () => {
  const strong = "k".repeat(48);
  const real = { MP_OAUTH_MODE: "real", MP_CLIENT_ID: "1", MP_CLIENT_SECRET: "s", PAYMENT_ENC_KEY: strong, PUBLIC_API_URL: "https://api.exemplo.com.br" };

  it("fora de dev/teste o modo é obrigatório e o fake é recusado (production, staging, prod…); off e real passam", () => {
    for (const NODE_ENV of ["production", "staging", "prod", "homolog"]) {
      expect(() => assertPaymentsBootConfig({ NODE_ENV }, currentKey), NODE_ENV).toThrow(/MP_OAUTH_MODE não configurado/);
      expect(() => assertPaymentsBootConfig({ NODE_ENV, MP_OAUTH_MODE: "fake" }, currentKey), NODE_ENV).toThrow(/só roda em dev\/teste/);
      expect(assertPaymentsBootConfig({ NODE_ENV, MP_OAUTH_MODE: "off" }, currentKey)).toBe("off");
    }
    expect(() => assertPaymentsBootConfig({ MP_OAUTH_MODE: "talvez" }, currentKey)).toThrow(/inválido/);
  });

  it("dev/teste EXPLÍCITOS: fake por padrão; real exige as credenciais; NODE_ENV ausente NÃO relaxa (fail-closed)", () => {
    for (const NODE_ENV of ["development", "test"]) expect(assertPaymentsBootConfig({ NODE_ENV }, currentKey)).toBe("fake");
    expect(() => assertPaymentsBootConfig({}, currentKey)).toThrow(/MP_OAUTH_MODE não configurado/);
    expect(() => assertPaymentsBootConfig({ NODE_ENV: "" }, currentKey)).toThrow(/MP_OAUTH_MODE não configurado/);
    expect(() => assertPaymentsBootConfig({ MP_OAUTH_MODE: "fake" }, currentKey)).toThrow(/só roda em dev\/teste/);
    expect(() => assertPaymentsBootConfig({ NODE_ENV: "development", MP_OAUTH_MODE: "real" }, currentKey)).toThrow(/MP_CLIENT_ID/);
  });

  it("real em produção: exige chave de cifra forte, credenciais e PUBLIC_API_URL https; com tudo certo sobe", () => {
    const saved = process.env.VITEST;
    delete process.env.VITEST; // fora do vitest, a chave de teste do repositório e a ausência de chave NÃO valem
    try {
      const prod = { NODE_ENV: "production", ...real };
      expect(assertPaymentsBootConfig(prod, currentKey)).toBe("real");
      expect(() => assertPaymentsBootConfig({ ...prod, PAYMENT_ENC_KEY: undefined } as never, currentKey)).toThrow(/PAYMENT_ENC_KEY não configurado/);
      expect(() => assertPaymentsBootConfig({ ...prod, PAYMENT_ENC_KEY: "curta" }, currentKey)).toThrow(/fraco/);
      expect(() => assertPaymentsBootConfig({ ...prod, MP_CLIENT_SECRET: "" }, currentKey)).toThrow(/MP_CLIENT_ID e MP_CLIENT_SECRET/);
      expect(() => assertPaymentsBootConfig({ ...prod, PUBLIC_API_URL: "http://api.exemplo.com.br" }, currentKey)).toThrow(/https/);
      expect(() => assertPaymentsBootConfig({ ...prod, PUBLIC_API_URL: undefined } as never, currentKey)).toThrow(/https/);
      expect(() => assertPaymentsBootConfig({ ...prod, JWT_SECRET: strong }, currentKey)).toThrow(/diferente de JWT_SECRET/);
    } finally {
      process.env.VITEST = saved;
    }
  });

  it("o app NÃO sobe com configuração inválida (falha no boot, não no primeiro PIX)", () => {
    const saved = { ...process.env };
    try {
      process.env.NODE_ENV = "production";
      delete process.env.MP_OAUTH_MODE;
      expect(() => makeApp()).toThrow(/MP_OAUTH_MODE/);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});

describe("P-3/P-4: log sem code/state e recifrar com a chave atual", () => {
  it("redactLogUrl remove a query do callback do OAuth e mantém o caminho; outras URLs ficam como estão", () => {
    expect(redactLogUrl("/api/store/payments/mercadopago/callback?code=TG-123&state=abc")).toBe("/api/store/payments/mercadopago/callback?[redigido]");
    expect(redactLogUrl("/auth/reset-password?token=x")).toBe("/auth/reset-password?[redigido]");
    expect(redactLogUrl("/stores/loja/menu?x=1")).toBe("/stores/loja/menu?x=1");
    expect(redactLogUrl("/api/orders")).toBe("/api/orders");
    expect(redactLogUrl(undefined)).toBeUndefined();
  });

  it("reencryptAll: passa tudo para a chave atual, é idempotente e o dado continua decifrando; a chave anterior pode sair", async () => {
    await resetDb();
    const storeA = (await prisma.store.create({ data: { name: "A", slug: "loja-rc-a", code: "RC1" } })).id;
    const storeB = (await prisma.store.create({ data: { name: "B", slug: "loja-rc-b", code: "RC2" } })).id;
    const oldEnv = { PAYMENT_ENC_KEY: "o".repeat(48), PAYMENT_ENC_KEY_ID: "v1" };
    const mk = (storeId: string, seller: string, token: string) =>
      prisma.paymentAccount.create({
        data: {
          storeId,
          sellerUserId: seller,
          accessTokenEnc: encryptSecret(token, { storeId, provider: "mercadopago", field: "accessToken" }, oldEnv),
          refreshTokenEnc: encryptSecret(`r-${token}`, { storeId, provider: "mercadopago", field: "refreshToken" }, oldEnv),
          expiresAt: new Date(Date.now() + 90 * DAY),
        },
      });
    const a = await mk(storeA, "v-a", "token-a");
    const b = await mk(storeB, "v-b", "token-b");

    const rotated = { PAYMENT_ENC_KEY: "n".repeat(48), PAYMENT_ENC_KEY_ID: "v2", PAYMENT_ENC_KEY_PREV: "o".repeat(48), PAYMENT_ENC_KEY_PREV_ID: "v1" };
    const saved = { ...process.env };
    Object.assign(process.env, rotated);
    try {
      const service = new StorePaymentsService(prisma, () => new FakeMercadoPagoOAuth(), { log() {}, logStrict: async () => {} });
      expect(await service.reencryptAll("v2")).toEqual({ reencrypted: 2, alreadyCurrent: 0, failed: 0 });
      expect(await service.reencryptAll("v2")).toEqual({ reencrypted: 0, alreadyCurrent: 2, failed: 0 }); // idempotente
      const rows = await prisma.paymentAccount.findMany({ orderBy: { sellerUserId: "asc" } });
      expect(rows.every((r) => r.accessTokenEnc!.split(".")[1] === "v2" && r.refreshTokenEnc!.split(".")[1] === "v2")).toBe(true);
      expect(rows[0].id).toBe(a.id);
      expect(rows[1].id).toBe(b.id);
      // sem a chave anterior, tudo continua decifrando (a anterior já pode ser removida)
      delete process.env.PAYMENT_ENC_KEY_PREV;
      delete process.env.PAYMENT_ENC_KEY_PREV_ID;
      expect(decryptSecret(rows[0].accessTokenEnc!, { storeId: storeA, provider: "mercadopago", field: "accessToken" })).toBe("token-a");
      expect(decryptSecret(rows[1].refreshTokenEnc!, { storeId: storeB, provider: "mercadopago", field: "refreshToken" })).toBe("r-token-b");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      await resetDb();
    }
  });
});
