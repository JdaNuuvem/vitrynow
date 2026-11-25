import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as securityEvents from "../src/lib/securityEvents";
import { ALERT_RULES, observeSecurityEvent, resetSecurityAlerts, securityEvent, type SecurityEvent } from "../src/lib/securityEvents";
import { makeApp, registerStore, resetDb } from "./helpers";

// NG-12 (alertas): regras e limiares sobre os eventos de segurança. Um alerta por regra+chave e por janela; chave = IP já normalizado ou conta em hash.

const MIN = 60_000;
const rule = (name: string) => ALERT_RULES.find((r) => r.name === name)!;
const feed = (event: SecurityEvent, n: number, subject: { ipKey: string; account?: string }, t0 = 1_000_000, stepMs = 1000) => {
  const fired: ReturnType<typeof observeSecurityEvent> = [];
  for (let i = 0; i < n; i += 1) fired.push(...observeSecurityEvent(event, subject, t0 + i * stepMs));
  return fired;
};

describe("NG-12: regras de alerta (unidade)", () => {
  beforeEach(() => resetSecurityAlerts());

  it("LOGIN_FAILURES_PER_IP: abaixo do limiar nada; no limiar UM alerta; mais falhas na mesma janela não repetem; IP diferente é outra chave", () => {
    const r = rule("LOGIN_FAILURES_PER_IP");
    expect(feed("login_failed", r.threshold - 1, { ipKey: "1.1.1.1" })).toHaveLength(0);
    const fired = observeSecurityEvent("login_failed", { ipKey: "1.1.1.1" }, 1_000_000 + 60_000);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ rule: "LOGIN_FAILURES_PER_IP", scope: "ip", key: "1.1.1.1", count: r.threshold, windowSec: 300 });
    expect(feed("login_failed", 20, { ipKey: "1.1.1.1" }, 1_000_000 + 61_000)).toHaveLength(0); // já alertou nesta janela
    expect(feed("login_failed", r.threshold, { ipKey: "2.2.2.2" }).map((a) => a.key)).toEqual(["2.2.2.2"]);
  });

  it("depois que a janela passa o alerta pode disparar de novo; falha antiga fora da janela não conta", () => {
    const r = rule("LOGIN_FAILURES_PER_IP");
    expect(feed("login_failed", r.threshold, { ipKey: "3.3.3.3" })).toHaveLength(1);
    const later = 1_000_000 + 6 * MIN;
    expect(feed("login_failed", r.threshold - 1, { ipKey: "3.3.3.3" }, later)).toHaveLength(0); // as velhas saíram da janela
    expect(observeSecurityEvent("login_failed", { ipKey: "3.3.3.3" }, later + 30_000)).toHaveLength(1);
  });

  it("LOGIN_FAILURES_PER_ACCOUNT_MULTI_IP: só dispara com 8 falhas na conta vindas de PELO MENOS 3 IPs diferentes (credential stuffing distribuído)", () => {
    const account = "abcdef012345";
    // 8 falhas de UM IP só: a regra por IP cuida; a distribuída NÃO dispara
    expect(feed("login_failed", 8, { ipKey: "9.9.9.9", account }).filter((a) => a.rule === "LOGIN_FAILURES_PER_ACCOUNT_MULTI_IP")).toHaveLength(0);
    resetSecurityAlerts();
    const fired: ReturnType<typeof observeSecurityEvent> = [];
    ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"].forEach((ip, i) => fired.push(...feed("login_failed", 2, { ipKey: ip, account }, 1_000_000 + i * 10_000)));
    const multi = fired.filter((a) => a.rule === "LOGIN_FAILURES_PER_ACCOUNT_MULTI_IP");
    expect(multi).toHaveLength(1);
    expect(multi[0]).toMatchObject({ scope: "account", key: account, count: 8, distinctIps: 4 });
  });

  it("evento sem conta não alimenta regra por conta; regra global (SESSION_REJECTED_SPIKE) soma todos os IPs", () => {
    expect(feed("password_reset_requested", 10, { ipKey: "5.5.5.5" })).toHaveLength(0);
    const spike = rule("SESSION_REJECTED_SPIKE");
    const fired: ReturnType<typeof observeSecurityEvent> = [];
    for (let i = 0; i < spike.threshold; i += 1) fired.push(...observeSecurityEvent("session_rejected", { ipKey: `10.0.${i}.1` }, 1_000_000 + i * 100));
    expect(fired.filter((a) => a.rule === "SESSION_REJECTED_SPIKE")).toHaveLength(1);
  });

  it("as demais regras disparam no limiar: origem errada, chave de impressora recusada, reset em excesso por conta e back-office", () => {
    expect(feed("origin_mismatch", rule("ORIGIN_MISMATCH_BURST").threshold, { ipKey: "6.6.6.6" }).map((a) => a.rule)).toEqual(["ORIGIN_MISMATCH_BURST"]);
    expect(feed("device_token_refused", rule("DEVICE_TOKEN_REFUSED_BURST").threshold, { ipKey: "7.7.7.7" }).map((a) => a.rule)).toEqual(["DEVICE_TOKEN_REFUSED_BURST"]);
    expect(feed("password_reset_requested", rule("PASSWORD_RESET_FLOOD_PER_ACCOUNT").threshold, { ipKey: "8.8.8.8", account: "aaaaaaaaaaaa" }).map((a) => a.rule)).toEqual(["PASSWORD_RESET_FLOOD_PER_ACCOUNT"]);
    // back-office: limiar BAIXO (3) misturando senha errada e MFA errado do mesmo IP
    const platform = [...feed("platform_login_failed", 2, { ipKey: "11.11.11.11" }), ...observeSecurityEvent("platform_mfa_failed", { ipKey: "11.11.11.11" }, 1_003_000)];
    expect(platform.map((a) => a.rule)).toEqual(["PLATFORM_LOGIN_FAILURES"]);
  });

  it("o alerta vai ao log como `security_alert` (nível error) sem e-mail nem IP cru; o evento comum continua `security_event`", () => {
    const calls: { level: string; entry: Record<string, unknown>; msg: string }[] = [];
    const log = {
      warn: (entry: Record<string, unknown>, msg: string) => calls.push({ level: "warn", entry, msg }),
      info: (entry: Record<string, unknown>, msg: string) => calls.push({ level: "info", entry, msg }),
      error: (entry: Record<string, unknown>, msg: string) => calls.push({ level: "error", entry, msg }),
    };
    const request = { log, ip: "203.0.113.50", headers: {}, socket: { remoteAddress: "203.0.113.50" } } as unknown as Parameters<typeof securityEvent>[0];
    for (let i = 0; i < rule("LOGIN_FAILURES_PER_IP").threshold; i += 1) securityEvent(request, "login_failed", { email: "alvo@loja.com" });
    const alerts = calls.filter((c) => c.msg === "security_alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: "error", entry: { securityAlert: "LOGIN_FAILURES_PER_IP", scope: "ip", count: 10 } });
    expect(JSON.stringify(calls)).not.toContain("alvo@loja.com");
    expect(calls.filter((c) => c.msg === "security_event")).toHaveLength(10);
  });
});

describe("NG-12: eventos de reset de senha e do back-office nas rotas reais", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    resetSecurityAlerts();
    await resetDb();
    app = makeApp();
    await app.ready();
  });
  afterAll(async () => {
    await resetDb(); // não deixa loja/usuário para o próximo arquivo (o mfa-notices só limpa DEPOIS de cada teste)
    await prisma.$disconnect();
  });

  it("pedir redefinição gera `password_reset_requested` IGUAL para conta existente e inexistente; reset recusado gera `password_reset_refused`; login do back-office errado gera `platform_login_failed`", async () => {
    const spy = vi.spyOn(securityEvents, "securityEvent");
    const { credentials } = await registerStore(app);
    await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: credentials.email } });
    await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "nao-existe@exemplo.com" } });
    const requested = spy.mock.calls.filter((c) => c[1] === "password_reset_requested");
    expect(requested).toHaveLength(2); // sem oráculo: o mesmo evento nos dois casos

    await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token: "x".repeat(40), email: credentials.email, newPassword: "senha-nova-12345" } });
    expect(spy.mock.calls.some((c) => c[1] === "password_reset_refused" && c[2]?.reason === "TOKEN_REFUSED")).toBe(true);

    await app.inject({ method: "POST", url: "/api/platform/auth/login", payload: { email: "admin@plataforma.test", password: "senha-errada-123" } });
    expect(spy.mock.calls.some((c) => c[1] === "platform_login_failed")).toBe(true);
    spy.mockRestore();
  }, 60000);
});

describe("SEC-34b: SERVER_BUSY_RATE", () => {
  beforeEach(() => resetSecurityAlerts());
  it("abaixo do limiar nada; no limiar UM alerta global por janela; depois da janela alerta de novo", () => {
    const r = rule("SERVER_BUSY_RATE");
    expect(feed("server_busy", r.threshold - 1, { ipKey: "1.1.1.1" })).toHaveLength(0);
    expect(feed("server_busy", 1, { ipKey: "2.2.2.2" }, 1_000_000 + r.threshold * 1000)).toHaveLength(1); // IPs diferentes somam (escopo global)
    expect(feed("server_busy", 30, { ipKey: "3.3.3.3" }, 1_000_000 + 40_000)).toHaveLength(0);
    expect(feed("server_busy", r.threshold, { ipKey: "3.3.3.3" }, 1_000_000 + 10 * MIN)).toHaveLength(1);
  });
});
