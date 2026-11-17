import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import bcrypt from "bcryptjs";
import { makeApp, registerStore, login, resetDb } from "./helpers";
import { hashToken } from "../src/lib/tokenHash";

// NG-01 / ADR-0008: sessão com exp, tokenVersion, releitura por requisição, sid, Origin.
describe("sessão do painel (ADR-0008)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
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

  const SID = "s".repeat(22);
  const nowS = () => Math.floor(Date.now() / 1000);
  const me = (cookie: string) => app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
  const decode = (cookie: string) => app.jwt.decode<Record<string, unknown>>(cookie.split("=")[1])!;
  const sign = (payload: Record<string, unknown>, opts?: Record<string, unknown>) =>
    `mc_session=${app.jwt.sign(payload as never, opts as never)}`;
  const setCookie = (res: { headers: Record<string, unknown> }) => (res.headers["set-cookie"] as string).split(";")[0];

  async function ownerWithId() {
    const { cookie, credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    return { cookie: cookie!, credentials, user };
  }

  it("o token emitido tem sub, tv, auth_time, sid e exp (sem storeId/role)", async () => {
    const { cookie, user } = await ownerWithId();
    const payload = decode(cookie);
    expect(payload.sub).toBe(user.id);
    expect(payload.tv).toBe(0);
    expect(typeof payload.exp).toBe("number");
    expect(typeof payload.auth_time).toBe("number");
    expect(String(payload.sid).length).toBeGreaterThanOrEqual(22); // 128 bits em base64url
    expect(payload).not.toHaveProperty("storeId");
    expect(payload).not.toHaveProperty("role");
    // D07: exp existe e respeita a janela de 12 h
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(12 * 3600);
  });

  it("recusa token sem exp (D07), mesmo com assinatura válida", async () => {
    const { user } = await ownerWithId();
    const res = await me(sign({ sub: user.id, tv: 0, auth_time: nowS(), sid: SID }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("SESSION_INVALID");
  });

  it("recusa token no formato antigo (userId/storeId/role)", async () => {
    const { user } = await ownerWithId();
    const res = await me(sign({ userId: user.id, storeId: user.storeId, role: "OWNER" }, { expiresIn: "1h" }));
    expect(res.statusCode).toBe(401);
  });

  it("recusa token expirado", async () => {
    const { user } = await ownerWithId();
    const res = await me(sign({ sub: user.id, tv: 0, auth_time: nowS() - 7200, sid: SID, iat: nowS() - 7200, exp: nowS() - 10 }));
    expect(res.statusCode).toBe(401);
  });

  it("recusa token assinado com outro segredo e token alg=none", async () => {
    const { user } = await ownerWithId();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = b64({ alg: "HS256", typ: "JWT" });
    const body = b64({ sub: user.id, tv: 0, auth_time: nowS(), sid: SID, exp: nowS() + 3600 });
    const sig = createHmac("sha256", "outro-segredo").update(`${head}.${body}`).digest("base64url");
    expect((await me(`mc_session=${head}.${body}.${sig}`)).statusCode).toBe(401);
    const none = `${b64({ alg: "none", typ: "JWT" })}.${body}.`;
    expect((await me(`mc_session=${none}`)).statusCode).toBe(401);
  });

  it("teto absoluto: auth_time com mais de 14 dias exige novo login", async () => {
    const { user } = await ownerWithId();
    const old = nowS() - 15 * 86400;
    const res = await me(sign({ sub: user.id, tv: 0, auth_time: old, sid: SID }, { expiresIn: 3600 }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("SESSION_EXPIRED");
  });

  it("usuário removido perde acesso na hora (D06)", async () => {
    const { cookie: ownerCookie, user: owner } = await ownerWithId();
    const staff = await prisma.user.create({
      data: { storeId: owner.storeId, email: "func@teste.com", passwordHash: await bcrypt.hash("senha12345", 4), role: "STAFF" },
    });
    const { cookie: staffCookie } = await login(app, "func@teste.com", "senha12345");
    expect((await me(staffCookie!)).statusCode).toBe(200);
    const del = await app.inject({ method: "POST", url: `/api/users/${staff.id}/delete`, headers: { cookie: ownerCookie } });
    expect(del.statusCode).toBe(200);
    const after = await me(staffCookie!);
    expect(after.statusCode).toBe(401);
    expect(JSON.parse(after.body).code).toBe("SESSION_REVOKED");
  });

  it("troca de senha derruba a sessão antiga e entrega cookie novo ao dispositivo atual (D06b)", async () => {
    const { cookie: first, credentials } = await ownerWithId();
    const { cookie: second } = await login(app, credentials.email, credentials.password); // outro dispositivo
    const change = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie: first },
      payload: { currentPassword: credentials.password, newPassword: "nova-senha-123" },
    });
    expect(change.statusCode).toBe(200);
    const renewed = setCookie(change);
    expect((await me(first)).statusCode).toBe(401);
    expect((await me(second!)).statusCode).toBe(401);
    expect((await me(renewed)).statusCode).toBe(200);
    expect(decode(renewed).tv).toBe(1);
  });

  it("redefinição de senha derruba sessões abertas", async () => {
    const { cookie, credentials, user } = await ownerWithId();
    const token = "t".repeat(32);
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000) } });
    const reset = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token, email: credentials.email, newPassword: "outra-senha-123" } });
    expect(reset.statusCode).toBe(200);
    expect((await me(cookie)).statusCode).toBe(401);
    expect((await login(app, credentials.email, "outra-senha-123")).response.statusCode).toBe(200);
  });

  it("'sair de todos os dispositivos' derruba as outras sessões e mantém só a nova deste dispositivo", async () => {
    const { cookie, credentials } = await ownerWithId();
    const { cookie: other } = await login(app, credentials.email, credentials.password);
    const res = await app.inject({ method: "POST", url: "/auth/logout-all", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const renewed = setCookie(res);
    expect((await me(other!)).statusCode).toBe(401);
    expect((await me(cookie)).statusCode).toBe(401);
    expect((await me(renewed)).statusCode).toBe(200);
  });

  it("papel vem do banco: OWNER rebaixado a STAFF perde ações de dono imediatamente", async () => {
    const { cookie, user } = await ownerWithId();
    expect((await app.inject({ method: "GET", url: "/api/users", headers: { cookie } })).statusCode).toBe(200);
    await prisma.user.update({ where: { id: user.id }, data: { role: "STAFF" } });
    expect((await app.inject({ method: "GET", url: "/api/users", headers: { cookie } })).statusCode).toBe(403);
  });

  it("renovação deslizante mantém auth_time e sid; sem renovar quando recém-emitido", async () => {
    const { user } = await ownerWithId();
    const authTime = nowS() - 3600;
    const nearExpiry = sign({ sub: user.id, tv: 0, auth_time: authTime, sid: SID }, { expiresIn: 600 });
    const res = await me(nearExpiry);
    expect(res.statusCode).toBe(200);
    const payload = decode(setCookie(res));
    expect(payload.auth_time).toBe(authTime);
    expect(payload.sid).toBe(SID);
    expect((payload.exp as number) - nowS()).toBeGreaterThan(11 * 3600);

    const fresh = await me(sign({ sub: user.id, tv: 0, auth_time: nowS(), sid: SID }, { expiresIn: 12 * 3600 }));
    expect(fresh.headers["set-cookie"]).toBeUndefined();
  });

  it("renovação nunca ultrapassa o teto absoluto de 14 dias", async () => {
    const { user } = await ownerWithId();
    const authTime = nowS() - 14 * 86400 + 1800; // sobram 30 min do teto
    const res = await me(sign({ sub: user.id, tv: 0, auth_time: authTime, sid: SID }, { expiresIn: 600 }));
    expect(res.statusCode).toBe(200);
    const renewed = decode(setCookie(res));
    expect(renewed.exp as number).toBeLessThanOrEqual(authTime + 14 * 86400);
  });

  it("escrita autenticada com Origin diferente do painel é recusada; mesma origem e sem Origin passam", async () => {
    const { cookie } = await ownerWithId();
    const post = (origin?: string) =>
      app.inject({ method: "POST", url: "/auth/logout-all", headers: { cookie, ...(origin ? { origin } : {}) } });
    const bad = await post("https://evil.example");
    expect(bad.statusCode).toBe(403);
    expect(JSON.parse(bad.body).code).toBe("ORIGIN_MISMATCH");
    expect((await post("http://localhost:3000")).statusCode).toBe(200);
  });

  it("cookie de sessão: HttpOnly, SameSite=Lax, Secure por padrão e Max-Age de 12 h", async () => {
    const { response } = await registerStore(app);
    const raw = String(response.headers["set-cookie"]);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/Max-Age=43200/);
  });
});
