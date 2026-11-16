import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import bcrypt from "bcryptjs";
import { prisma } from "@meucardapio/db";
import * as emailLib from "../src/lib/email";
import { hashToken } from "../src/lib/tokenHash";
import { makeApp, registerStore, resetDb } from "./helpers";

// NG-06 / ST-06 / ST-12 / ST-07: tokens só com hash, listagem sem segredo, sockets fecham na revogação.
describe("tokens com hash e sockets revogáveis", () => {
  let app: ReturnType<typeof makeApp>;
  const resetUrls: string[] = [];

  beforeEach(async () => {
    resetUrls.length = 0;
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async ({ resetUrl }) => {
      resetUrls.push(resetUrl);
    });
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

  const closedWith = (ws: WebSocket, ms = 3000) =>
    new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("socket não fechou")), ms);
      ws.on("close", (code) => {
        clearTimeout(t);
        resolve(code);
      });
    });

  async function owner() {
    const { cookie, credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    return { cookie: cookie!, credentials, user };
  }
  async function newDeviceToken(cookie: string, label = "balcão") {
    const res = await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie }, payload: { label } });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body).token as { id: string; token: string; tokenPreview: string };
  }

  it("o banco não guarda o token de impressora: só hash e os 4 últimos caracteres", async () => {
    const { cookie } = await owner();
    const created = await newDeviceToken(cookie);
    const row = await prisma.deviceToken.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.tokenHash).toBe(hashToken(created.token));
    expect(row.tokenPreview).toBe(created.token.slice(-4));
    expect(JSON.stringify(row)).not.toContain(created.token);
    const raw = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "DeviceToken" WHERE "tokenHash" = $1`, created.token);
    expect(raw[0].n).toBe(0); // o valor em si não é o que está guardado
  });

  it("a listagem não devolve token nem hash ao dono, e STAFF nem a vê (ST-12)", async () => {
    const { cookie, user } = await owner();
    const created = await newDeviceToken(cookie);
    await prisma.user.create({ data: { storeId: user.storeId, email: "func@teste.com", passwordHash: await bcrypt.hash("senha123", 4), role: "STAFF" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "func@teste.com", password: "senha123" } });
    const staffCookie = (login.headers["set-cookie"] as string).split(";")[0];

    const res = await app.inject({ method: "GET", url: "/api/device-tokens", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(created.token);
    expect(res.body).not.toContain(hashToken(created.token));
    const item = JSON.parse(res.body).tokens[0];
    expect(item).not.toHaveProperty("token");
    expect(item).not.toHaveProperty("tokenHash");
    expect(item.tokenPreview).toBe(created.tokenPreview);

    // STAFF: listar, criar e revogar são ações de dono (403)
    expect((await app.inject({ method: "GET", url: "/api/device-tokens", headers: { cookie: staffCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: staffCookie }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/device-tokens/${created.id}/revoke`, headers: { cookie: staffCookie } })).statusCode).toBe(403);
  });

  it("o token autentica o print-client; o hash vazado do banco NÃO autentica", async () => {
    const { cookie } = await owner();
    const created = await newDeviceToken(cookie);
    const ok = await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: { authorization: `Bearer ${created.token}` } });
    expect(ok.statusCode).toBe(200);
    const row = await prisma.deviceToken.findUniqueOrThrow({ where: { id: created.id } });
    const withHash = await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: { authorization: `Bearer ${row.tokenHash}` } });
    expect(withHash.statusCode).toBe(401);
  });

  it("chave revogada perde o acesso HTTP", async () => {
    const { cookie } = await owner();
    const created = await newDeviceToken(cookie);
    await app.inject({ method: "POST", url: `/api/device-tokens/${created.id}/revoke`, headers: { cookie } });
    const res = await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: { authorization: `Bearer ${created.token}` } });
    expect(res.statusCode).toBe(401);
  });

  it("revogar a chave fecha o WebSocket aberto do print-client na hora (código 4401)", async () => {
    const { cookie } = await owner();
    const created = await newDeviceToken(cookie);
    const ws = await app.injectWS("/ws/device", { headers: { authorization: `Bearer ${created.token}` } });
    const closed = closedWith(ws);
    const res = await app.inject({ method: "POST", url: `/api/device-tokens/${created.id}/revoke`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(await closed).toBe(4401);
  });

  it("WebSocket do painel fecha ao 'sair de todos os dispositivos' e ao trocar a senha", async () => {
    const { cookie, credentials } = await owner();
    const ws1 = await app.injectWS("/ws/panel", { headers: { cookie } });
    const closed1 = closedWith(ws1);
    const out = await app.inject({ method: "POST", url: "/auth/logout-all", headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(await closed1).toBe(4401);

    const renewed = (out.headers["set-cookie"] as string).split(";")[0];
    const ws2 = await app.injectWS("/ws/panel", { headers: { cookie: renewed } });
    const closed2 = closedWith(ws2);
    const change = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie: renewed },
      payload: { currentPassword: credentials.password, newPassword: "nova-senha-123" },
    });
    expect(change.statusCode).toBe(200);
    expect(await closed2).toBe(4401);
  });

  it("WebSocket do painel fecha quando o usuário é removido", async () => {
    const { cookie, user } = await owner();
    const staff = await prisma.user.create({ data: { storeId: user.storeId, email: "func@teste.com", passwordHash: await bcrypt.hash("senha123", 4), role: "STAFF" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "func@teste.com", password: "senha123" } });
    const staffCookie = (login.headers["set-cookie"] as string).split(";")[0];
    const ws = await app.injectWS("/ws/panel", { headers: { cookie: staffCookie } });
    const closed = closedWith(ws);
    const del = await app.inject({ method: "POST", url: `/api/users/${staff.id}/delete`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect(await closed).toBe(4401);
  });

  it("WebSocket do painel recusa Origin diferente do painel (ST-07)", async () => {
    const { cookie } = await owner();
    await expect(app.injectWS("/ws/panel", { headers: { cookie, origin: "https://evil.example" } })).rejects.toThrow();
    const ok = await app.injectWS("/ws/panel", { headers: { cookie, origin: "http://localhost:3000" } });
    ok.terminate();
  });

  it("redefinição de senha: o banco guarda só o hash e o hash não serve como token", async () => {
    const { credentials, user } = await owner();
    await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: credentials.email } });
    const plain = new URL(resetUrls.at(-1)!).searchParams.get("token")!;
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.tokenHash).toBe(hashToken(plain));
    expect(row.tokenHash).not.toBe(plain);

    const withHash = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token: row.tokenHash, newPassword: "outra-senha-123" } });
    expect(withHash.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token: plain, newPassword: "outra-senha-123" } });
    expect(ok.statusCode).toBe(200);
  });
});
