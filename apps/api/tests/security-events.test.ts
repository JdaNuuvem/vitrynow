import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as securityEvents from "../src/lib/securityEvents";
import { accountTag, securityEvent, SECURITY_EVENTS } from "../src/lib/securityEvents";
import { makeApp, registerStore, resetDb } from "./helpers";

// NG-12: eventos de segurança em log estruturado (formato único, sem segredo, conta só como hash curto).

function fakeRequest() {
  const calls: { level: "warn" | "info"; entry: Record<string, unknown>; msg: string }[] = [];
  const log = {
    warn: (entry: Record<string, unknown>, msg: string) => calls.push({ level: "warn", entry, msg }),
    info: (entry: Record<string, unknown>, msg: string) => calls.push({ level: "info", entry, msg }),
  };
  const request = { log, ip: "203.0.113.9", headers: {}, socket: { remoteAddress: "203.0.113.9" } } as unknown as Parameters<typeof securityEvent>[0];
  return { request, calls };
}

describe("NG-12: securityEvent (unidade)", () => {
  it("formato único: nome do evento, IP normalizado e mensagem fixa; falhas em warn, sucesso em info", () => {
    const { request, calls } = fakeRequest();
    securityEvent(request, "login_failed", { email: "Dono@Loja.com" });
    securityEvent(request, "login_ok", { email: "dono@loja.com", userId: "u1" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ level: "warn", msg: "security_event", entry: { securityEvent: "login_failed", ipKey: "203.0.113.9" } });
    expect(calls[1]).toMatchObject({ level: "info", msg: "security_event", entry: { securityEvent: "login_ok", userId: "u1" } });
  });

  it("a conta vira HASH curto e estável (maiúscula/minúscula e espaço não mudam); o e-mail nunca aparece", () => {
    const { request, calls } = fakeRequest();
    securityEvent(request, "login_failed", { email: "  Dono@Loja.com " });
    const entry = calls[0].entry;
    expect(entry.account).toBe(accountTag("dono@loja.com"));
    expect(String(entry.account)).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(calls)).not.toContain("loja.com");
    expect(JSON.stringify(calls)).not.toMatch(/dono/i);
  });

  it("`reason` só aceita CÓDIGO fixo (maiúsculas e sublinhado); texto livre é descartado", () => {
    const { request, calls } = fakeRequest();
    securityEvent(request, "session_rejected", { reason: "SESSION_REVOKED" });
    securityEvent(request, "session_rejected", { reason: "senha errada: 123456 do João" });
    expect(calls[0].entry.reason).toBe("SESSION_REVOKED");
    expect(calls[1].entry.reason).toBeUndefined();
  });

  it("nunca lança, mesmo com o logger quebrado", () => {
    const request = { log: { warn: () => { throw new Error("log fora do ar"); }, info: () => { throw new Error("log fora do ar"); } }, ip: "1.2.3.4", headers: {}, socket: {} } as unknown as Parameters<typeof securityEvent>[0];
    expect(() => securityEvent(request, "login_failed", { email: "a@b.com" })).not.toThrow();
  });

  it("a lista de eventos é fechada e cada um é usado como nome estável de alerta", () => {
    expect([...SECURITY_EVENTS].sort()).toEqual([
      "device_token_refused", "login_failed", "login_locked", "login_ok", "logout_all", "origin_mismatch", "password_reset_done", "password_reset_refused",
      "password_reset_requested", "platform_login_failed", "platform_login_locked", "platform_login_ok", "platform_mfa_failed", "session_rejected",
    ]);
  });
});

describe("NG-12: eventos nas rotas reais", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    await resetDb();
    app = makeApp();
    await app.ready();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("login errado, login certo, bloqueio por tentativas, origem errada, sessão inválida e chave de impressora recusada geram o evento certo", async () => {
    const spy = vi.spyOn(securityEvents, "securityEvent");
    const names = () => spy.mock.calls.map((c) => c[1]);
    const { credentials, cookie } = await registerStore(app);

    await app.inject({ method: "POST", url: "/auth/login", payload: { email: credentials.email, password: "senha-errada-999" } });
    expect(names()).toContain("login_failed");
    const ok = await app.inject({ method: "POST", url: "/auth/login", payload: { email: credentials.email, password: credentials.password } });
    expect(ok.statusCode).toBe(200);
    expect(names()).toContain("login_ok");
    // o evento de sucesso leva o e-mail só como parâmetro de hash: nada de senha no registro
    expect(JSON.stringify(spy.mock.calls.map((c) => c[2]))).not.toContain(credentials.password);

    for (let i = 0; i < 8; i += 1) await app.inject({ method: "POST", url: "/auth/login", payload: { email: credentials.email, password: "outra-errada-" + i } });
    expect(names()).toContain("login_locked");

    const wrongOrigin = await app.inject({ method: "POST", url: "/auth/logout-all", headers: { cookie: cookie!, origin: "https://atacante.example" } });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(names()).toContain("origin_mismatch");

    await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: "mc_session=lixo" } });
    expect(names()).toContain("session_rejected");

    const noToken = await app.inject({ method: "GET", url: "/api/device/orders/pending" });
    expect(noToken.statusCode).toBe(401);
    const badToken = await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: { authorization: "Bearer mcd_inexistente" } });
    expect(badToken.statusCode).toBe(401);
    expect(spy.mock.calls.filter((c) => c[1] === "device_token_refused").map((c) => c[2]?.reason).sort()).toEqual(["TOKEN_MISSING", "TOKEN_UNKNOWN"]);
    spy.mockRestore();
  }, 60000);
});
