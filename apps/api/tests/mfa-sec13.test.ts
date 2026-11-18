import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { sendMfaCodeEmail } from "../src/lib/email";
import { assertMfaBootConfig } from "../src/lib/mfaBoot";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/email", () => ({
  sendPasswordResetEmail: vi.fn(),
  sendMfaCodeEmail: vi.fn(),
  sendLoginAlertEmail: vi.fn(),
  maskEmail: (email: string) => email,
}));

// SEC-13 (ST-14/ST-15): MFA obrigatório em produção (boot recusa sem) e cobrindo chave de impressora (criar e revogar), cancelar assinatura e convidar OWNER.

describe("SEC-13: o boot recusa produção sem MFA", () => {
  it("produção, NODE_ENV ausente ou escrito diferente SEM MFA_ENFORCED=true ⇒ erro; só 'true' sobe", () => {
    for (const NODE_ENV of ["production", undefined, "prod", "staging", ""]) {
      expect(() => assertMfaBootConfig({ NODE_ENV } as NodeJS.ProcessEnv), `NODE_ENV=${NODE_ENV}`).toThrow(/MFA_ENFORCED/);
      expect(() => assertMfaBootConfig({ NODE_ENV, MFA_ENFORCED: "false" } as NodeJS.ProcessEnv)).toThrow(/MFA_ENFORCED/);
      expect(() => assertMfaBootConfig({ NODE_ENV, MFA_ENFORCED: "1" } as NodeJS.ProcessEnv)).toThrow(/MFA_ENFORCED/);
      expect(() => assertMfaBootConfig({ NODE_ENV, MFA_ENFORCED: "true" } as NodeJS.ProcessEnv)).not.toThrow();
    }
  });
  it("development e test sobem sem MFA (sem provedor de e-mail)", () => {
    expect(() => assertMfaBootConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertMfaBootConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe("SEC-13: ações sensíveis exigem comprovante da FINALIDADE certa", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(async () => {
    process.env.MFA_ENFORCED = "true";
    vi.mocked(sendMfaCodeEmail).mockClear();
    await resetDb();
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

  async function proof(cookie: string, purpose: string): Promise<string> {
    const challenge = await app.inject({ method: "POST", url: "/api/mfa/challenge", headers: { cookie }, payload: { purpose } });
    expect(challenge.statusCode, `desafio ${purpose}`).toBe(201);
    const challengeId = JSON.parse(challenge.body).challengeId as string;
    const code = vi.mocked(sendMfaCodeEmail).mock.calls.at(-1)![0].code;
    const verify = await app.inject({ method: "POST", url: "/api/mfa/verify", headers: { cookie }, payload: { challengeId, code } });
    expect(verify.statusCode).toBe(200);
    return challengeId;
  }
  const call = (method: "POST", url: string, cookie: string, payload?: unknown, challenge?: string) =>
    app.inject({ method, url, headers: { cookie, ...(challenge ? { "x-mfa-challenge": challenge } : {}) }, payload: payload as never });

  it("criar chave de impressora: sem comprovante 403 MFA_REQUIRED; com o da finalidade certa passa (uso único); com o de OUTRA finalidade não", async () => {
    const { cookie } = await registerStore(app);
    const without = await call("POST", "/api/device-tokens", cookie!, { label: "Balcão" });
    expect(without.statusCode).toBe(403);
    expect(JSON.parse(without.body)).toMatchObject({ code: "MFA_REQUIRED", purpose: "device_token_create" });

    const wrong = await proof(cookie!, "refund");
    expect((await call("POST", "/api/device-tokens", cookie!, { label: "Balcão" }, wrong)).statusCode).toBe(403);

    const right = await proof(cookie!, "device_token_create");
    const ok = await call("POST", "/api/device-tokens", cookie!, { label: "Balcão" }, right);
    expect(ok.statusCode).toBe(200);
    expect((await call("POST", "/api/device-tokens", cookie!, { label: "Outra" }, right)).statusCode, "uso único").toBe(403);
  });

  it("revogar chave de impressora exige comprovante 'device_token_revoke'", async () => {
    const { cookie } = await registerStore(app);
    const created = await call("POST", "/api/device-tokens", cookie!, { label: "Balcão" }, await proof(cookie!, "device_token_create"));
    const id = JSON.parse(created.body).token.id as string;
    const without = await call("POST", `/api/device-tokens/${id}/revoke`, cookie!);
    expect(without.statusCode).toBe(403);
    expect(JSON.parse(without.body).purpose).toBe("device_token_revoke");
    expect((await call("POST", `/api/device-tokens/${id}/revoke`, cookie!, undefined, await proof(cookie!, "device_token_revoke"))).statusCode).toBe(200);
  });

  it("cancelar assinatura exige 'cancel_subscription' (sem comprovante nem chega à regra de negócio)", async () => {
    const { cookie } = await registerStore(app);
    const without = await call("POST", "/api/store/subscription/cancel", cookie!);
    expect(without.statusCode).toBe(403);
    expect(JSON.parse(without.body)).toMatchObject({ code: "MFA_REQUIRED", purpose: "cancel_subscription" });
    // com o comprovante a regra de negócio responde (a assinatura de teste não está ativa: 409), prova de que o portão deixou passar
    const withProof = await call("POST", "/api/store/subscription/cancel", cookie!, undefined, await proof(cookie!, "cancel_subscription"));
    expect(withProof.statusCode).toBe(409);
  });

  it("convidar OWNER exige 'invite_owner'; convidar STAFF não pede MFA", async () => {
    const { cookie } = await registerStore(app);
    const body = (role: string) => ({ email: `${role.toLowerCase()}-novo@teste.com`, password: "senha-do-convidado-1", role });
    const without = await call("POST", "/api/users", cookie!, body("OWNER"));
    expect(without.statusCode).toBe(403);
    expect(JSON.parse(without.body)).toMatchObject({ code: "MFA_REQUIRED", purpose: "invite_owner" });
    expect(await prisma.user.count({ where: { email: "owner-novo@teste.com" } })).toBe(0);

    const staff = await call("POST", "/api/users", cookie!, body("STAFF"));
    expect(JSON.parse(staff.body).code, "STAFF nunca recebe MFA_REQUIRED").not.toBe("MFA_REQUIRED");

    const owner = await call("POST", "/api/users", cookie!, body("OWNER"), await proof(cookie!, "invite_owner"));
    expect(owner.statusCode, owner.body).toBe(201);
    expect(await prisma.user.count({ where: { email: "owner-novo@teste.com", role: "OWNER" } })).toBe(1);
  });

  it("sem MFA_ENFORCED (dev/teste) nada muda: as quatro ações passam direto", async () => {
    delete process.env.MFA_ENFORCED;
    const { cookie } = await registerStore(app);
    expect((await call("POST", "/api/device-tokens", cookie!, { label: "Balcão" })).statusCode).toBe(200);
    expect((await call("POST", "/api/store/subscription/cancel", cookie!)).statusCode).toBe(409);
  });
});
