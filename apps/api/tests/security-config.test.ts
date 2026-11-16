import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getJwtSecret, getMfaKey, trustProxySetting, cookieSecure } from "../src/lib/securityConfig";
import { buildApp } from "../src/app";

// NG-02 / ST-04 / ADR-0008 §1.5-1.7: segredos e proxy falham ALTO fora de NODE_ENV=test.
describe("configuração de segurança", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.NODE_ENV = "development";
    delete process.env.JWT_SECRET;
    delete process.env.MFA_HMAC_KEY;
    delete process.env.TRUST_PROXY_CIDR;
    delete process.env.COOKIE_SECURE;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const strong = () => "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";

  it("JWT_SECRET ausente derruba o boot fora de test (nada de segredo de dev)", async () => {
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
    await expect(buildApp().ready()).rejects.toThrow(/JWT_SECRET/);
  });

  it("recusa segredo curto ou de exemplo, em qualquer NODE_ENV que não seja test", () => {
    for (const bad of ["dev-secret-change-me", "troque-este-segredo-em-producao", "curto"]) {
      process.env.JWT_SECRET = bad;
      expect(() => getJwtSecret()).toThrow(/fraco|exemplo/);
    }
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "dev-secret-change-me";
    expect(() => getJwtSecret()).toThrow();
  });

  it("aceita segredo forte; em test usa o segredo de teste sem exigir nada", () => {
    process.env.JWT_SECRET = strong();
    expect(getJwtSecret()).toBe(strong());
    process.env.NODE_ENV = "test";
    delete process.env.JWT_SECRET;
    expect(getJwtSecret()).toContain("test");
  });

  it("MFA exige chave própria, diferente do JWT_SECRET", () => {
    process.env.JWT_SECRET = strong();
    expect(() => getMfaKey()).toThrow(/MFA_HMAC_KEY/);
    process.env.MFA_HMAC_KEY = strong();
    expect(() => getMfaKey()).toThrow(/diferente/);
    process.env.MFA_HMAC_KEY = "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2";
    expect(getMfaKey()).toBe(process.env.MFA_HMAC_KEY);
  });

  it("cookie Secure por padrão; só COOKIE_SECURE=false explícito desliga", () => {
    expect(cookieSecure()).toBe(true);
    process.env.NODE_ENV = "development";
    expect(cookieSecure()).toBe(true);
    process.env.COOKIE_SECURE = "false";
    expect(cookieSecure()).toBe(false);
  });

  it("trustProxy: desligado por padrão; lista de CIDRs quando configurada", () => {
    expect(trustProxySetting()).toBe(false);
    process.env.TRUST_PROXY_CIDR = "172.18.0.0/16, 10.0.0.5";
    expect(trustProxySetting()).toEqual(["172.18.0.0/16", "10.0.0.5"]);
  });
});

// D15 / B04: rate limit por IP real atrás do proxy, sem permitir forjar X-Forwarded-For.
describe("rate limit e trustProxy (B04)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const loginAttempt = (app: ReturnType<typeof buildApp>, remoteAddress: string, xff?: string) =>
    app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress,
      headers: xff ? { "x-forwarded-for": xff } : {},
      payload: { email: "ninguem@teste.com", password: "senha-qualquer" },
    });

  it("sem trustProxy, X-Forwarded-For é ignorado: spoof não contorna o limite de login", async () => {
    delete process.env.TRUST_PROXY_CIDR;
    const app = buildApp();
    await app.ready();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await loginAttempt(app, "203.0.113.7", `198.51.100.${i}`)).statusCode);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(4); // 12 - 8 de limite
    await app.close();
  });

  it("com trustProxy no CIDR do proxy, cada cliente real tem o seu contador (D15)", async () => {
    process.env.TRUST_PROXY_CIDR = "10.0.0.0/8";
    const app = buildApp();
    await app.ready();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await loginAttempt(app, "10.0.0.2", `198.51.100.${i}`)).statusCode);
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
    // mesmo cliente real repetindo ainda é limitado
    const same: number[] = [];
    for (let i = 0; i < 12; i++) same.push((await loginAttempt(app, "10.0.0.2", "198.51.100.200")).statusCode);
    expect(same.filter((s) => s === 429).length).toBeGreaterThanOrEqual(4);
    await app.close();
  });

  it("X-Forwarded-For vindo de quem NÃO é o proxy confiável é ignorado", async () => {
    process.env.TRUST_PROXY_CIDR = "10.0.0.0/8";
    const app = buildApp();
    await app.ready();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await loginAttempt(app, "203.0.113.7", `198.51.100.${i}`)).statusCode);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(4);
    await app.close();
  });
});
