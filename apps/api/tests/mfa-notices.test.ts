import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { sendMfaCodeEmail } from "../src/lib/email";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/email", () => ({
  sendPasswordResetEmail: vi.fn(),
  sendMfaCodeEmail: vi.fn(),
}));

describe("confirmação de segurança (MFA)", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(async () => {
    process.env.MFA_ENFORCED = "true";
    vi.mocked(sendMfaCodeEmail).mockClear();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    delete process.env.MFA_ENFORCED;
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const changePassword = (cookie: string, challengeId?: string) =>
    app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie, ...(challengeId ? { "x-mfa-challenge": challengeId } : {}) },
      payload: { currentPassword: "senha123", newPassword: "novasenha456" },
    });

  async function requestChallenge(cookie: string) {
    const response = await app.inject({ method: "POST", url: "/api/mfa/challenge", headers: { cookie }, payload: { purpose: "change_password" } });
    const body = JSON.parse(response.body);
    const sent = vi.mocked(sendMfaCodeEmail).mock.calls.at(-1)![0];
    return { response, challengeId: body.challengeId as string, code: sent.code };
  }

  it("ação sensível sem comprovante responde 403 MFA_REQUIRED", async () => {
    const { cookie } = await registerStore(app);
    const response = await changePassword(cookie!);
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).code).toBe("MFA_REQUIRED");
  });

  it("código correto gera comprovante de uso único e o código nunca vai na resposta", async () => {
    const { cookie } = await registerStore(app);
    const { response, challengeId, code } = await requestChallenge(cookie!);
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain(code);
    expect(JSON.parse(response.body).maskedEmail).toMatch(/\*/);

    const verify = await app.inject({ method: "POST", url: "/api/mfa/verify", headers: { cookie: cookie! }, payload: { challengeId, code } });
    expect(verify.statusCode).toBe(200);

    expect((await changePassword(cookie!, challengeId)).statusCode).toBe(200);
    // segundo uso do mesmo comprovante é recusado
    expect((await changePassword(cookie!, challengeId)).statusCode).toBe(403);
  });

  it("código errado bloqueia o desafio após 5 tentativas", async () => {
    const { cookie } = await registerStore(app);
    const { challengeId, code } = await requestChallenge(cookie!);

    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await app.inject({ method: "POST", url: "/api/mfa/verify", headers: { cookie: cookie! }, payload: { challengeId, code: wrong } });
      expect(response.statusCode).toBe(400);
    }
    const locked = await app.inject({ method: "POST", url: "/api/mfa/verify", headers: { cookie: cookie! }, payload: { challengeId, code } });
    expect(locked.statusCode).toBe(429);
  });

  it("comprovante verificado para uma ação não serve para outra", async () => {
    const { cookie } = await registerStore(app);
    const { challengeId, code } = await requestChallenge(cookie!);
    await app.inject({ method: "POST", url: "/api/mfa/verify", headers: { cookie: cookie! }, payload: { challengeId, code } });

    const refund = await app.inject({ method: "POST", url: "/api/orders/qualquer/refund", headers: { cookie: cookie!, "x-mfa-challenge": challengeId } });
    expect(refund.statusCode).toBe(403);
    expect(JSON.parse(refund.body).code).toBe("MFA_REQUIRED");
  });

  it("sem MFA_ENFORCED a ação passa direto (compatível com o front atual)", async () => {
    delete process.env.MFA_ENFORCED;
    const { cookie } = await registerStore(app);
    expect((await changePassword(cookie!)).statusCode).toBe(200);
  });
});

describe("avisos da plataforma", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(async () => {
    process.env.ADMIN_TOKEN = "token-admin-de-teste";
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    delete process.env.ADMIN_TOKEN;
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const publish = (payload: Record<string, unknown>, token = "token-admin-de-teste") =>
    app.inject({ method: "POST", url: "/api/admin/notices", headers: { "x-admin-token": token }, payload });

  it("só a plataforma publica; o lojista lista, vê não lidos e marca como lido", async () => {
    expect((await publish({ title: "Novidade", body: "Texto" }, "errado")).statusCode).toBe(401);
    const created = await publish({ title: "Novidade", body: "Agora temos KDS" });
    expect(created.statusCode).toBe(201);
    const noticeId = JSON.parse(created.body).notice.id;

    const { cookie } = await registerStore(app);
    const list = JSON.parse((await app.inject({ method: "GET", url: "/api/notices", headers: { cookie: cookie! } })).body);
    expect(list.unreadCount).toBe(1);
    expect(list.notices[0].title).toBe("Novidade");

    await app.inject({ method: "POST", url: `/api/notices/${noticeId}/read`, headers: { cookie: cookie! } });
    const after = JSON.parse((await app.inject({ method: "GET", url: "/api/notices", headers: { cookie: cookie! } })).body);
    expect(after.unreadCount).toBe(0);
    expect(after.notices[0].read).toBe(true);
  });

  it("aviso expirado não aparece, leitura é por usuário e sem ADMIN_TOKEN a publicação fica desligada", async () => {
    await publish({ title: "Velho", body: "x", expiresAt: new Date(Date.now() - 1000).toISOString() });
    await publish({ title: "Atual", body: "y" });

    const a = await registerStore(app);
    const b = await registerStore(app);
    const listA = JSON.parse((await app.inject({ method: "GET", url: "/api/notices", headers: { cookie: a.cookie! } })).body);
    expect(listA.notices.map((n: { title: string }) => n.title)).toEqual(["Atual"]);

    await app.inject({ method: "POST", url: `/api/notices/${listA.notices[0].id}/read`, headers: { cookie: a.cookie! } });
    const listB = JSON.parse((await app.inject({ method: "GET", url: "/api/notices", headers: { cookie: b.cookie! } })).body);
    expect(listB.unreadCount).toBe(1);

    delete process.env.ADMIN_TOKEN;
    expect((await publish({ title: "Z", body: "z" }, "qualquer")).statusCode).toBe(401);
  });
});
