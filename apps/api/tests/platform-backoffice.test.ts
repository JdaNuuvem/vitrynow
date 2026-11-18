import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { sendCreditChangeEmail, sendMfaCodeEmail } from "../src/lib/email";
import { createPlatformAdmin, makeApp, platformCreditProof, platformLogin, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/email", () => ({
  sendPasswordResetEmail: vi.fn(),
  sendMfaCodeEmail: vi.fn(),
  sendLoginAlertEmail: vi.fn(),
  sendPaymentReconnectEmail: vi.fn(),
  sendCreditChangeEmail: vi.fn(async () => {}),
}));

// Cada teste faz vários hashes bcrypt (cadastro, login da equipe, reautenticação): em máquina carregada passa de 15 s.
vi.setConfig({ testTimeout: 40_000 });

// API-25: back-office da plataforma (RN-BKO-01..04, CA-BKO-01..08) e concessão manual de créditos (ADR-0015 §3D, RN-CRE-02/06/09).
describe("back-office da plataforma", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(async () => {
    vi.mocked(sendMfaCodeEmail).mockClear();
    vi.mocked(sendCreditChangeEmail).mockClear();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    delete process.env.PLATFORM_ALERT_EMAIL;
    delete process.env.CREDIT_GRANT_MAX;
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (response: { body: string }) => JSON.parse(response.body);
  const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
  const post = (url: string, cookie: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url, headers: { cookie, ...headers }, payload: payload as never });

  async function staff(role: "ADMIN" | "SUPPORT" = "ADMIN") {
    const created = await createPlatformAdmin(role);
    const { cookie } = await platformLogin(app, created.email, created.password);
    return { ...created, cookie: cookie! };
  }
  async function newStore() {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    return { cookie: cookie!, storeId, slug: json(response).store.slug as string };
  }

  describe("acesso (RN-BKO-01, CA-BKO-01)", () => {
    it("senha certa não abre sessão: só o código por e-mail abre; sem o código não entra", async () => {
      const { email, password } = await createPlatformAdmin("SUPPORT");
      const step1 = await app.inject({ method: "POST", url: "/api/platform/auth/login", payload: { email, password } });
      expect(step1.statusCode).toBe(202);
      expect(step1.headers["set-cookie"]).toBeUndefined();
      const { challengeId } = json(step1);
      const sent = vi.mocked(sendMfaCodeEmail).mock.calls.at(-1)![0];
      expect(step1.body).not.toContain(sent.code);

      const wrong = sent.code === "000000" ? "111111" : "000000";
      const bad = await app.inject({ method: "POST", url: "/api/platform/auth/verify", payload: { challengeId, code: wrong } });
      expect(bad.statusCode).toBe(400);
      expect(bad.headers["set-cookie"]).toBeUndefined();

      const ok = await app.inject({ method: "POST", url: "/api/platform/auth/verify", payload: { challengeId, code: sent.code } });
      expect(ok.statusCode).toBe(200);
      expect(String(ok.headers["set-cookie"])).toContain("mc_platform_session");
      // o código é de uso único
      const again = await app.inject({ method: "POST", url: "/api/platform/auth/verify", payload: { challengeId, code: sent.code } });
      expect(again.statusCode).toBe(400);
    });

    it("senha errada, conta inexistente e conta desativada recebem a mesma resposta 401", async () => {
      const a = await createPlatformAdmin("SUPPORT");
      const off = await createPlatformAdmin("SUPPORT");
      await prisma.platformAdmin.update({ where: { id: off.admin.id }, data: { disabledAt: new Date() } });
      const attempts = [
        { email: a.email, password: "errada-errada-123" },
        { email: "naoexiste@plataforma.teste", password: a.password },
        { email: off.email, password: off.password },
      ];
      for (const payload of attempts) {
        const response = await app.inject({ method: "POST", url: "/api/platform/auth/login", payload });
        expect(response.statusCode).toBe(401);
        expect(json(response)).toEqual({ error: "credenciais inválidas" });
      }
      expect(sendMfaCodeEmail).not.toHaveBeenCalled();
    });

    it("usuário de loja não entra no back-office e a sessão da equipe não abre o painel da loja", async () => {
      const store = await newStore();
      const { cookie: staffCookie } = await staff("ADMIN");
      expect((await get("/api/platform/stores", store.cookie)).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/api/platform/stores" })).statusCode).toBe(401);
      expect((await get("/api/notices", staffCookie.replace("mc_platform_session", "mc_session"))).statusCode).toBe(401);
      // login de loja com credencial de equipe também não existe
      const crossLogin = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "equipe1@plataforma.teste", password: "senha-da-equipe-12345" } });
      expect(crossLogin.statusCode).toBe(401);
      // cookie de loja colocado no cookie da equipe: recusado
      const forged = store.cookie.replace("mc_session", "mc_platform_session");
      expect((await get("/api/platform/me", forged)).statusCode).toBe(401);
    });

    it("sair encerra a sessão: o cookie copiado deixa de valer", async () => {
      const { cookie } = await staff("SUPPORT");
      expect((await get("/api/platform/me", cookie)).statusCode).toBe(200);
      await post("/api/platform/auth/logout", cookie, {});
      expect((await get("/api/platform/me", cookie)).statusCode).toBe(401);
    });

    it("conta desativada perde a sessão na hora", async () => {
      const { cookie, admin } = await staff("SUPPORT");
      await prisma.platformAdmin.update({ where: { id: admin.id }, data: { disabledAt: new Date() } });
      expect((await get("/api/platform/me", cookie)).statusCode).toBe(401);
    });
  });

  describe("lojas (RN-BKO-02/03/04, CA-BKO-04/08)", () => {
    it("lista com busca, plano/assinatura e sem segredo nem dado de cliente; a leitura fica auditada", async () => {
      const a = await newStore();
      const b = await newStore();
      await prisma.store.update({ where: { id: a.storeId }, data: { name: "Pizzaria do Zé" } });
      const { cookie, admin } = await staff("SUPPORT");

      const all = json(await get("/api/platform/stores", cookie));
      expect(all.total).toBe(2);
      const found = json(await get("/api/platform/stores?q=pizzaria", cookie));
      expect(found.stores.map((s: { id: string }) => s.id)).toEqual([a.storeId]);
      expect(found.stores[0]).toMatchObject({ ownerEmail: expect.stringContaining("@teste.com"), suspended: false, paymentConnected: true, printerOnline: false, lastOrderAt: null });
      expect(found.stores[0].subscription.state).toBe("trial");
      const byEmail = json(await get(`/api/platform/stores?q=${encodeURIComponent(all.stores.find((s: { id: string }) => s.id === b.storeId).ownerEmail)}`, cookie));
      expect(byEmail.stores.map((s: { id: string }) => s.id)).toEqual([b.storeId]);

      const raw = JSON.stringify(all);
      for (const forbidden of ["passwordHash", "accessToken", "refreshToken", "tokenHash", "secret", "$2b$"]) expect(raw).not.toContain(forbidden);
      const rows = await prisma.platformAuditLog.findMany({ where: { adminId: admin.id, action: "stores.list" } });
      expect(rows.length).toBe(3);
      expect(JSON.stringify(rows)).not.toContain("pizzaria"); // a busca em si não vai para o rastro
    });

    it("detalhe: assinatura, pagamentos da assinatura e saldo; 404 para loja inexistente; auditoria da leitura", async () => {
      const s = await newStore();
      const { cookie, admin } = await staff("SUPPORT");
      const detail = await get(`/api/platform/stores/${s.storeId}`, cookie);
      expect(detail.statusCode).toBe(200);
      const body = json(detail);
      expect(body.store).toMatchObject({ id: s.storeId, suspended: false, paymentStatus: "CONNECTED" });
      expect(body.subscription.status).toBe("TRIAL");
      expect(body.creditBalance).toBe(0);
      for (const forbidden of ["passwordHash", "accessToken", "refreshToken", "pixQrCode", "tokenHash"]) expect(detail.body).not.toContain(forbidden);
      expect((await prisma.platformAuditLog.findMany({ where: { adminId: admin.id, storeId: s.storeId, action: "store.view" } })).length).toBe(1);
      expect((await get("/api/platform/stores/inexistente", cookie)).statusCode).toBe(404);
    });
  });

  describe("suspender e reativar (CA-BKO-05)", () => {
    it("exige motivo; suspensa fica somente leitura no painel, recusa pedidos e a reativação volta na hora", async () => {
      const s = await newStore();
      const { cookie, admin } = await staff("SUPPORT");

      expect((await post(`/api/platform/stores/${s.storeId}/suspend`, cookie, {})).statusCode).toBe(400);
      expect((await post(`/api/platform/stores/${s.storeId}/suspend`, cookie, { reason: "abc" })).statusCode).toBe(400);
      expect((await post(`/api/platform/stores/${s.storeId}/suspend`, cookie, { reason: "fraude confirmada" })).statusCode).toBe(200);
      expect((await post(`/api/platform/stores/${s.storeId}/suspend`, cookie, { reason: "fraude confirmada" })).statusCode).toBe(409);

      // painel: leitura continua, escrita é recusada
      expect((await get("/api/notices", s.cookie)).statusCode).toBe(200);
      const write = await post("/api/store/settings", s.cookie, {});
      expect(write.statusCode).toBe(403);
      expect(json(write).code).toBe("STORE_SUSPENDED");
      // cardápio público: não aceita pedido
      const menu = json(await app.inject({ method: "GET", url: `/stores/${s.slug}/menu` }));
      expect(menu.store.acceptingOrders).toBe(false);
      const order = await app.inject({ method: "POST", url: `/stores/${s.slug}/orders`, payload: {} });
      expect(order.statusCode).toBe(409);
      expect(json(order).code).toBe("STORE_SUSPENDED");

      expect((await post(`/api/platform/stores/${s.storeId}/reactivate`, cookie, { reason: "regularizado" })).statusCode).toBe(200);
      expect((await post(`/api/platform/stores/${s.storeId}/reactivate`, cookie, { reason: "regularizado" })).statusCode).toBe(409);
      expect((await post("/auth/logout-all", s.cookie, {})).statusCode).toBe(200);

      const actions = (await prisma.platformAuditLog.findMany({ where: { adminId: admin.id, storeId: s.storeId }, orderBy: { createdAt: "asc" } })).map((r) => [r.action, r.reason]);
      expect(actions).toEqual([["store.suspend", "fraude confirmada"], ["store.reactivate", "regularizado"]]);
    });

    it("suspender uma loja não afeta a outra (isolamento)", async () => {
      const a = await newStore();
      const b = await newStore();
      const { cookie } = await staff("SUPPORT");
      await post(`/api/platform/stores/${a.storeId}/suspend`, cookie, { reason: "motivo válido" });
      expect((await post("/auth/logout-all", b.cookie, {})).statusCode).toBe(200);
      const menuB = json(await app.inject({ method: "GET", url: `/stores/${b.slug}/menu` }));
      expect(menuB.store.acceptingOrders).toBe(true);
    });
  });

  describe("estender o trial (CA-BKO-02)", () => {
    it("sem motivo é recusado; com motivo muda o fim do trial e grava auditoria; fora do trial é 409", async () => {
      const s = await newStore();
      const { cookie, admin } = await staff("SUPPORT");
      const before = (await prisma.subscription.findUniqueOrThrow({ where: { storeId: s.storeId } })).trialEndsAt;

      expect((await post(`/api/platform/stores/${s.storeId}/extend-trial`, cookie, { days: 7 })).statusCode).toBe(400);
      expect((await post(`/api/platform/stores/${s.storeId}/extend-trial`, cookie, { days: 0, reason: "cliente pediu" })).statusCode).toBe(400);
      const ok = await post(`/api/platform/stores/${s.storeId}/extend-trial`, cookie, { days: 7, reason: "cliente pediu mais tempo" });
      expect(ok.statusCode).toBe(200);
      const after = (await prisma.subscription.findUniqueOrThrow({ where: { storeId: s.storeId } })).trialEndsAt;
      expect(after.getTime() - before.getTime()).toBe(7 * 24 * 3600 * 1000);
      const audit = await prisma.platformAuditLog.findFirstOrThrow({ where: { adminId: admin.id, action: "subscription.extend_trial" } });
      expect(audit.reason).toBe("cliente pediu mais tempo");
      expect(audit.storeId).toBe(s.storeId);

      await prisma.subscription.update({ where: { storeId: s.storeId }, data: { status: "ACTIVE" } });
      expect((await post(`/api/platform/stores/${s.storeId}/extend-trial`, cookie, { days: 7, reason: "cliente pediu mais tempo" })).statusCode).toBe(409);
    });
  });

  describe("créditos: concessão manual (ADR-0015 §3D)", () => {
    const grant = (storeId: string, cookie: string, proof: string | undefined, over: Record<string, unknown> = {}, password = "senha-da-equipe-12345") =>
      post(
        `/api/platform/stores/${storeId}/credits`,
        cookie,
        { reason: "PURCHASE", credits: 10, note: "Pix recebido do lojista", externalRef: "PIX-2026-0001", idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, password, ...over },
        proof ? { "x-mfa-challenge": proof } : {},
      );

    it("só ADMIN concede; SUPPORT recebe 403 e nada é lançado", async () => {
      const s = await newStore();
      const { cookie } = await staff("SUPPORT");
      const response = await grant(s.storeId, cookie, undefined);
      expect(response.statusCode).toBe(403);
      expect(json(response).code).toBe("PLATFORM_ROLE_REQUIRED");
      expect(await prisma.aiCreditLedger.count()).toBe(0);
    });

    it("exige reautenticação: sem comprovante MFA → 403 MFA_REQUIRED; senha errada → 403 REAUTH_FAILED", async () => {
      const s = await newStore();
      const { cookie } = await staff("ADMIN");
      const noProof = await grant(s.storeId, cookie, undefined);
      expect(noProof.statusCode).toBe(403);
      expect(json(noProof).code).toBe("MFA_REQUIRED");
      const proof = await platformCreditProof(app, cookie);
      const badPass = await grant(s.storeId, cookie, proof, {}, "senha-errada-123456");
      expect(badPass.statusCode).toBe(403);
      expect(json(badPass).code).toBe("REAUTH_FAILED");
      expect(await prisma.aiCreditLedger.count()).toBe(0);
    });

    it("caminho feliz: grava quem, quanto, motivo e referência; saldo = soma; preço opcional; comprovante é de uso único; avisa o OWNER", async () => {
      process.env.PLATFORM_ALERT_EMAIL = "responsavel@plataforma.teste";
      const s = await newStore();
      const { cookie, admin } = await staff("ADMIN");
      const proof = await platformCreditProof(app, cookie);
      const first = await grant(s.storeId, cookie, proof, { priceCents: 1500 });
      expect(first.statusCode).toBe(201);
      expect(json(first).entry).toMatchObject({ delta: 10, reason: "PURCHASE", note: "Pix recebido do lojista", externalRef: "PIX-2026-0001", priceCents: 1500, actorAdminId: admin.id });
      expect(json(first).balance).toBe(10);
      expect(json(first).large).toBe(false);

      // o mesmo comprovante não vale duas vezes
      expect((await grant(s.storeId, cookie, proof)).statusCode).toBe(403);

      // sem preço: nulo (sem cobrança registrada); segundo lançamento soma
      const second = await grant(s.storeId, cookie, await platformCreditProof(app, cookie), { reason: "GRANT", credits: 5, note: "compensação por falha nossa", externalRef: undefined });
      expect(second.statusCode).toBe(201);
      expect(json(second).entry.priceCents).toBeNull();
      expect(json(second).balance).toBe(15);

      const ledger = json(await get(`/api/platform/stores/${s.storeId}/credits`, cookie));
      expect(ledger.balance).toBe(15);
      expect(ledger.entries).toHaveLength(2);
      expect(json(await get(`/api/platform/stores/${s.storeId}`, cookie)).creditBalance).toBe(15);

      const recipients = vi.mocked(sendCreditChangeEmail).mock.calls.map(([m]) => m.to).sort();
      expect(recipients).toEqual(["responsavel@plataforma.teste", "responsavel@plataforma.teste", expect.stringContaining("@teste.com"), expect.stringContaining("@teste.com")].sort());
      const audits = await prisma.platformAuditLog.findMany({ where: { action: "credits.change", storeId: s.storeId } });
      expect(audits).toHaveLength(2);
    });

    it("regras do tipo: compra exige referência; só o ajuste pode ser negativo; ajuste não leva preço; limite por operação; concessão grande é sinalizada", async () => {
      const s = await newStore();
      const { cookie } = await staff("ADMIN");
      const bad = async (over: Record<string, unknown>) => grant(s.storeId, cookie, undefined, over); // a validação vem ANTES de gastar o comprovante
      expect((await bad({ externalRef: undefined })).statusCode).toBe(400); // PURCHASE sem referência
      expect((await bad({ reason: "GRANT", credits: -1, externalRef: undefined })).statusCode).toBe(400); // negativo fora de ADJUST
      expect((await bad({ credits: 0 })).statusCode).toBe(400);
      expect((await bad({ note: "ok" })).statusCode).toBe(400); // motivo obrigatório (mín. 5)
      expect((await bad({ credits: 101 })).statusCode).toBe(422);
      process.env.CREDIT_GRANT_MAX = "1000";
      const large = await grant(s.storeId, cookie, await platformCreditProof(app, cookie), { credits: 60 });
      expect(large.statusCode).toBe(201);
      expect(json(large).large).toBe(true);
      expect((await prisma.platformAuditLog.findFirstOrThrow({ where: { action: "credits.change" } })).metadata).toMatchObject({ large: true });
    });

    it("idempotência: a mesma chave não lança duas vezes e não gasta outro comprovante", async () => {
      const s = await newStore();
      const { cookie } = await staff("ADMIN");
      const key = "chave-idempotente-1";
      const first = await grant(s.storeId, cookie, await platformCreditProof(app, cookie), { idempotencyKey: key });
      expect(first.statusCode).toBe(201);
      const repeat = await grant(s.storeId, cookie, undefined, { idempotencyKey: key });
      expect(repeat.statusCode).toBe(200);
      expect(json(repeat)).toMatchObject({ idempotent: true, balance: 10 });
      expect(json(repeat).entry.id).toBe(json(first).entry.id);
      expect(await prisma.aiCreditLedger.count()).toBe(1);
    });

    it("ajuste negativo exige saldo suficiente; duas baixas simultâneas não deixam o saldo negativo", async () => {
      const s = await newStore();
      const { cookie } = await staff("ADMIN");
      await grant(s.storeId, cookie, await platformCreditProof(app, cookie), { credits: 100 });
      const adjust = { reason: "ADJUST", credits: -80, externalRef: undefined, note: "estorno de crédito não usado" };
      const [p1, p2] = [await platformCreditProof(app, cookie), await platformCreditProof(app, cookie)];
      const results = await Promise.all([grant(s.storeId, cookie, p1, adjust), grant(s.storeId, cookie, p2, adjust)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      const conflict = results.find((r) => r.statusCode === 409)!;
      expect(json(conflict).code).toBe("CREDIT_NEGATIVE_BALANCE");
      expect(json(await get(`/api/platform/stores/${s.storeId}/credits`, cookie)).balance).toBe(20);
    });

    it("isolamento: o saldo de uma loja não aparece nem se mistura com o da outra", async () => {
      const a = await newStore();
      const b = await newStore();
      const { cookie } = await staff("ADMIN");
      await grant(a.storeId, cookie, await platformCreditProof(app, cookie), { credits: 7 });
      expect(json(await get(`/api/platform/stores/${a.storeId}/credits`, cookie)).balance).toBe(7);
      const other = json(await get(`/api/platform/stores/${b.storeId}/credits`, cookie));
      expect(other.balance).toBe(0);
      expect(other.entries).toEqual([]);
      // ajuste negativo em B não "usa" o saldo de A
      const negative = await grant(b.storeId, cookie, await platformCreditProof(app, cookie), { reason: "ADJUST", credits: -1, externalRef: undefined, note: "tentativa sem saldo" });
      expect(negative.statusCode).toBe(409);
      expect((await grant("loja-que-nao-existe", cookie, undefined)).statusCode).toBe(404);
    });

    it("o lojista (OWNER ou STAFF) não alcança a concessão", async () => {
      const s = await newStore();
      const response = await post(`/api/platform/stores/${s.storeId}/credits`, s.cookie, { reason: "GRANT", credits: 5, note: "me dê créditos", idempotencyKey: "tentativa-lojista", password: "senha12345" });
      expect(response.statusCode).toBe(401);
      expect(await prisma.aiCreditLedger.count()).toBe(0);
    });

    it("livro-razão e auditoria são imutáveis NO BANCO (UPDATE e DELETE recusados)", async () => {
      const s = await newStore();
      const { cookie } = await staff("ADMIN");
      await grant(s.storeId, cookie, await platformCreditProof(app, cookie), {});
      await expect(prisma.aiCreditLedger.updateMany({ data: { delta: 9999 } })).rejects.toThrow(/imutável/);
      await expect(prisma.aiCreditLedger.deleteMany({})).rejects.toThrow(/imutável/);
      await expect(prisma.platformAuditLog.updateMany({ data: { action: "x" } })).rejects.toThrow(/imutável/);
      await expect(prisma.platformAuditLog.deleteMany({})).rejects.toThrow(/imutável/);
      await expect(prisma.store.delete({ where: { id: s.storeId } })).rejects.toThrow(); // loja com livro-razão não some em silêncio
      expect(json(await get(`/api/platform/stores/${s.storeId}/credits`, cookie)).balance).toBe(10);
    });
  });
});
