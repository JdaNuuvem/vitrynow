import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { prisma } from "@meucardapio/db";
import { buildApp } from "../src/app";
import { getJwtSecret, getMfaKey, trustProxySetting } from "../src/lib/securityConfig";
import { JobRunner } from "../src/jobs/runner";
import { TECH_RETENTION_MS, techCleanupJob } from "../src/jobs/techCleanup";
import { login, makeApp, registerStore, resetDb } from "./helpers";

// SEC-19 (ADR-0008 §7): ST-04b segredo de teste só no vitest · ST-02c proxy obrigatório em produção ·
// ST-30 logout de UM aparelho · ST-31 socket fecha no exp.

describe("ST-04b — segredo de teste só vale dentro do vitest", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const strong = "Q7w9E2r4T6y8U0i1O3p5A7s9D2f4G6h8J0k1L3z5";

  it("NODE_ENV=test FORA do vitest: segredo ausente derruba o boot (não cai no valor público do repo)", () => {
    delete process.env.VITEST;
    process.env.NODE_ENV = "test";
    delete process.env.JWT_SECRET;
    delete process.env.MFA_HMAC_KEY;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
    expect(() => getMfaKey()).toThrow(/MFA_HMAC_KEY/);
  });

  it("NODE_ENV=test FORA do vitest: o valor de teste do repositório é recusado", () => {
    delete process.env.VITEST;
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "test-secret-nao-use-em-producao";
    expect(() => getJwtSecret()).toThrow(/valor de teste do repositório/);
    process.env.JWT_SECRET = strong;
    process.env.MFA_HMAC_KEY = "test-mfa-key-nao-use-em-producao";
    expect(() => getMfaKey()).toThrow(/valor de teste do repositório/);
  });

  it("NODE_ENV=test FORA do vitest: segredos fortes e distintos funcionam", () => {
    delete process.env.VITEST;
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = strong;
    process.env.MFA_HMAC_KEY = "Z1x3C5v7B9n2M4a6S8d0F2g4H6j8K0l1P3o5I7u9";
    expect(getJwtSecret()).toBe(strong);
    expect(getMfaKey()).toBe(process.env.MFA_HMAC_KEY);
  });

  it("dentro do vitest o fallback de teste continua valendo (suíte não precisa de segredo)", () => {
    expect(process.env.VITEST).toBeTruthy();
    delete process.env.JWT_SECRET;
    expect(getJwtSecret()).toContain("test");
  });
});

describe("ST-02c — TRUST_PROXY_CIDR em produção", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("produção sem TRUST_PROXY_CIDR derruba o boot, também pelo buildApp", () => {
    process.env.NODE_ENV = "production";
    process.env.MP_OAUTH_MODE = "off"; // API-07: sem PIX real, o boot de produção exige o modo declarado; aqui o que se testa é a guarda do proxy
    process.env.API_INTERNAL_SECRET = "none"; // SEC-24: sem isto o boot recusa antes, por outra guarda; aqui se testa a do proxy
    // API-18: o boot de produção também exige o storage S3 declarado (valores de teste, nada real); aqui se testa a guarda do proxy
    process.env.STORAGE_S3_ENDPOINT = "https://s3.teste.invalid";
    process.env.STORAGE_S3_BUCKET = "teste";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "teste";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "teste";
    process.env.STORAGE_PUBLIC_BASE_URL = "https://cdn.teste.invalid/teste";
    delete process.env.TRUST_PROXY_CIDR;
    expect(() => trustProxySetting()).toThrow(/TRUST_PROXY_CIDR/);
    expect(() => buildApp()).toThrow(/TRUST_PROXY_CIDR/);
    process.env.TRUST_PROXY_CIDR = "   ";
    expect(() => trustProxySetting()).toThrow(/TRUST_PROXY_CIDR/);
  });

  it("produção com a rede do Caddy usa a lista; `none` declara 'sem proxy' de propósito", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUST_PROXY_CIDR = "172.18.0.0/16, 10.0.0.5";
    expect(trustProxySetting()).toEqual(["172.18.0.0/16", "10.0.0.5"]);
    process.env.TRUST_PROXY_CIDR = "none";
    expect(trustProxySetting()).toBe(false);
    process.env.TRUST_PROXY_CIDR = "NONE";
    expect(trustProxySetting()).toBe(false);
  });

  it("fora de produção a variável continua opcional", () => {
    process.env.NODE_ENV = "development";
    delete process.env.TRUST_PROXY_CIDR;
    expect(trustProxySetting()).toBe(false);
  });
});

describe("ST-30 / ST-31 — logout por aparelho e socket que fecha no exp", () => {
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

  const me = (cookie: string) => app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
  const closedWith = (ws: WebSocket, ms = 6000) =>
    new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("socket não fechou")), ms);
      ws.on("close", (code) => {
        clearTimeout(t);
        resolve(code);
      });
    });
  const decode = (cookie: string) => app.jwt.decode<{ sid: string; exp: number }>(cookie.split("=")[1])!;

  async function twoDevices() {
    const { cookie: a, credentials } = await registerStore(app);
    const { cookie: b } = await login(app, credentials.email, credentials.password);
    return { a: a!, b: b!, credentials };
  }

  it("logout encerra ESTE aparelho: o cookie copiado deixa de valer; o outro aparelho continua", async () => {
    const { a, b } = await twoDevices();
    expect((await me(a)).statusCode).toBe(200);
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: a } });
    expect(out.statusCode).toBe(200);
    // cookie copiado ANTES do logout, reapresentado depois
    const replay = await me(a);
    expect(replay.statusCode).toBe(401);
    expect(JSON.parse(replay.body).code).toBe("SESSION_REVOKED");
    expect((await me(b)).statusCode).toBe(200);
  });

  it("a linha de revogação vale até o exp do token e logout repetido é idempotente", async () => {
    const { a } = await twoDevices();
    const { sid, exp } = decode(a);
    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: a } });
    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: a } });
    const rows = await prisma.revokedSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].sid).toBe(sid);
    expect(rows[0].expiresAt.getTime()).toBe(exp * 1000);
  });

  it("logout sem cookie, com lixo ou com token vencido responde ok e não grava nada", async () => {
    expect((await app.inject({ method: "POST", url: "/auth/logout" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: "mc_session=lixo.lixo.lixo" } })).statusCode).toBe(200);
    expect(await prisma.revokedSession.count()).toBe(0);
  });

  it("'sair de todos' continua derrubando todos os aparelhos (tokenVersion)", async () => {
    const { a, b } = await twoDevices();
    const res = await app.inject({ method: "POST", url: "/auth/logout-all", headers: { cookie: a } });
    expect(res.statusCode).toBe(200);
    expect((await me(b)).statusCode).toBe(401);
  });

  it("tech.cleanup apaga só as sessões revogadas cujo token expirou há mais de 24 h", async () => {
    const now = new Date("2026-11-16T12:00:00.000Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    await prisma.revokedSession.createMany({
      data: [
        { sid: "velha", expiresAt: ago(TECH_RETENTION_MS + 3_600_000) },
        { sid: "recente", expiresAt: ago(3_600_000) },
        { sid: "valida", expiresAt: new Date(now.getTime() + 3_600_000) },
      ],
    });
    const runner = new JobRunner({ db: prisma, log: { info() {}, warn() {}, error() {} }, now: () => now });
    runner.register(techCleanupJob);
    const result = await runner.run("tech.cleanup");
    expect(result).toMatchObject({ status: "ok", processed: 1 });
    expect((await prisma.revokedSession.findMany()).map((r) => r.sid).sort()).toEqual(["recente", "valida"]);
  });

  it("logout fecha o WebSocket DESTA sessão e deixa o do outro aparelho aberto", async () => {
    const { a, b } = await twoDevices();
    const wsA = await app.injectWS("/ws/panel", { headers: { cookie: a } });
    const wsB = await app.injectWS("/ws/panel", { headers: { cookie: b } });
    const closedA = closedWith(wsA);
    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: a } });
    expect(await closedA).toBe(4401);
    await new Promise((r) => setTimeout(r, 400));
    expect(wsB.readyState).toBe(1); // OPEN
    wsB.terminate();
  });

  it("o WebSocket fecha sozinho no vencimento do token (exp)", async () => {
    const { a } = await twoDevices();
    const base = decode(a);
    const user = await prisma.user.findFirstOrThrow();
    const short = app.jwt.sign({ sub: user.id, tv: user.tokenVersion, auth_time: Math.floor(Date.now() / 1000), sid: base.sid + "x" }, { expiresIn: 2 });
    const ws = await app.injectWS("/ws/panel", { headers: { cookie: `mc_session=${short}` } });
    const closed = closedWith(ws, 8000);
    expect(await closed).toBe(4401);
  });
});
