import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, login, resetDb } from "./helpers";
import * as emailLib from "../src/lib/email";
import { hashToken } from "../src/lib/tokenHash";

describe("auth", () => {
  // Instância nova por teste: evita que o rate limit (estado em memória por instância)
  // vaze de um teste para o outro.
  let app: ReturnType<typeof makeApp>;

  const sentResetUrls: string[] = [];
  beforeEach(async () => {
    sentResetUrls.length = 0;
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async ({ resetUrl }) => {
      sentResetUrls.push(resetUrl);
    });
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

  it("registra uma loja nova e autentica com cookie httpOnly", async () => {
    const { response, cookie } = await registerStore(app);
    expect(response.statusCode).toBe(201);
    expect(cookie).toContain("mc_session=");
  });

  it("rejeita slug/código duplicado", async () => {
    await registerStore(app, { slug: "duplicada", code: "DUP" });
    const second = await registerStore(app, { slug: "duplicada", code: "DUP" });
    expect(second.response.statusCode).toBe(409);
  });

  it("rejeita login com senha errada e aceita com senha certa", async () => {
    const { credentials } = await registerStore(app);
    const wrong = await login(app, credentials.email, "senha-errada");
    expect(wrong.response.statusCode).toBe(401);

    const right = await login(app, credentials.email, credentials.password);
    expect(right.response.statusCode).toBe(200);
    expect(right.cookie).toContain("mc_session=");
  });

  it("/auth/me exige cookie válido", async () => {
    const noAuth = await app.inject({ method: "GET", url: "/auth/me" });
    expect(noAuth.statusCode).toBe(401);

    const { cookie } = await registerStore(app);
    const withAuth = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: cookie! } });
    expect(withAuth.statusCode).toBe(200);
  });

  it("STAFF não pode criar chave de impressora (ação restrita a OWNER)", async () => {
    const { cookie: ownerCookie, credentials } = await registerStore(app);
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: ownerCookie! } });
    const storeId = JSON.parse(me.body).user.storeId;

    await prisma.user.create({
      data: { storeId, email: "staff@teste.com", passwordHash: await hashLike(credentials.password), role: "STAFF" },
    });
    const { cookie: staffCookie } = await login(app, "staff@teste.com", credentials.password);

    const asStaff = await app.inject({
      method: "POST",
      url: "/api/device-tokens",
      headers: { cookie: staffCookie! },
      payload: { label: "teste" },
    });
    expect(asStaff.statusCode).toBe(403);

    const asOwner = await app.inject({
      method: "POST",
      url: "/api/device-tokens",
      headers: { cookie: ownerCookie! },
      payload: { label: "teste" },
    });
    expect(asOwner.statusCode).toBe(200);
  });

  it("troca de senha exige a senha atual correta", async () => {
    const { cookie, credentials } = await registerStore(app);

    const wrongCurrent = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie: cookie! },
      payload: { currentPassword: "errada", newPassword: "novaSenha123" },
    });
    expect(wrongCurrent.statusCode).toBe(401);

    const ok = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie: cookie! },
      payload: { currentPassword: credentials.password, newPassword: "novaSenha123" },
    });
    expect(ok.statusCode).toBe(200);

    const loginWithNew = await login(app, credentials.email, "novaSenha123");
    expect(loginWithNew.response.statusCode).toBe(200);
  });

  it("forgot-password nunca revela se o e-mail existe, e reset-password funciona com token válido", async () => {
    const { credentials } = await registerStore(app);

    const forUnknown = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "nao-existe@teste.com" },
    });
    expect(forUnknown.statusCode).toBe(200);

    const forKnown = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: credentials.email },
    });
    expect(forKnown.statusCode).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: credentials.email } });
    const resetToken = await prisma.passwordResetToken.findFirst({ where: { userId: user!.id } });
    expect(resetToken).toBeTruthy();
    // NG-06: o banco guarda só o hash; o valor só existe no link enviado por e-mail.
    const sentUrl = sentResetUrls.at(-1)!;
    const plainToken = new URL(sentUrl).searchParams.get("token")!;
    expect(plainToken).toHaveLength(32);
    expect(resetToken!.tokenHash).not.toBe(plainToken);
    expect(resetToken!.tokenHash).toBe(hashToken(plainToken));

    const reset = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: { token: plainToken, newPassword: "outraSenha123" },
    });
    expect(reset.statusCode).toBe(200);

    const loginWithNew = await login(app, credentials.email, "outraSenha123");
    expect(loginWithNew.response.statusCode).toBe(200);

    // token usado não pode ser reaproveitado
    const reuse = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: { token: plainToken, newPassword: "maisUmaSenha123" },
    });
    expect(reuse.statusCode).toBe(400);
  });

  it("limita tentativas de login (rate limit)", async () => {
    const { credentials } = await registerStore(app);
    const attempts = await Promise.all(
      Array.from({ length: 15 }, () => login(app, credentials.email, "senha-errada")),
    );
    const blocked = attempts.some((a) => a.response.statusCode === 429);
    expect(blocked).toBe(true);
  });
});

async function hashLike(password: string) {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(password, 10);
}
