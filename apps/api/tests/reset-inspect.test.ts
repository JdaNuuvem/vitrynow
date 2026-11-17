import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as emailLib from "../src/lib/email";
import { makeApp, registerStore, resetDb } from "./helpers";

// SEC-29 (ST-63, Sun Tzu): a página de redefinição mostra DE QUAL CONTA é o token antes de a pessoa digitar a senha nova (sem isto, um
// atacante manda à vítima o link da conta DELE). O endpoint NÃO consome o token e responde igual para qualquer token sem validade.

describe("POST /auth/reset-password/inspect (SEC-29)", () => {
  let app: ReturnType<typeof makeApp>;
  const urls: string[] = [];
  let ipSeq = 0;
  const nextIp = () => `10.88.0.${++ipSeq}`;

  beforeEach(async () => {
    await resetDb();
    app = makeApp(); // app novo por teste: o cadastro e o inspect têm limite por IP e o app guarda o contador
    urls.length = 0;
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async ({ resetUrl }) => {
      urls.push(resetUrl);
    });
    await app.ready();
  });
  afterEach(() => vi.restoreAllMocks());

  const tokenOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
  const inspect = (payload: unknown, ip = nextIp()) => app.inject({ method: "POST", url: "/auth/reset-password/inspect", remoteAddress: ip, payload: payload as never });

  async function accountWithToken() {
    const { credentials } = await registerStore(app, { email: "maria.silva@exemplo.com.br" });
    await app.inject({ method: "POST", url: "/auth/forgot-password", remoteAddress: nextIp(), payload: { email: credentials.email } });
    await vi.waitFor(() => expect(urls.length).toBe(1));
    return { credentials, token: tokenOf(urls[0]) };
  }

  it("token válido: devolve SÓ o e-mail mascarado e NÃO consome o token (depois dele a senha ainda se redefine)", async () => {
    const { credentials, token } = await accountWithToken();
    const res = await inspect({ token });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, email: "m***@exemplo.com.br" });
    expect(res.body).not.toContain("maria.silva");
    expect(res.headers["cache-control"]).toBe("no-store");

    // inspecionar 3 vezes não gasta o token
    for (let i = 0; i < 3; i += 1) expect((await inspect({ token })).json().valid).toBe(true);
    expect(await prisma.passwordResetToken.count({ where: { usedAt: { not: null } } })).toBe(0);

    const reset = await app.inject({ method: "POST", url: "/auth/reset-password", remoteAddress: nextIp(), payload: { token, email: "maria.silva@exemplo.com.br", newPassword: "outraSenha123" } });
    expect(reset.statusCode).toBe(200);
    expect(credentials.email).toBeTruthy();
  }, 60000);

  it("token inexistente, usado, expirado, vazio, enorme ou malformado: a MESMA resposta (nada de motivo), em qualquer caso", async () => {
    const { token } = await accountWithToken();
    await app.inject({ method: "POST", url: "/auth/reset-password", remoteAddress: nextIp(), payload: { token, email: "maria.silva@exemplo.com.br", newPassword: "outraSenha123" } }); // gasta o token

    const expired = await accountWithToken2();
    const bodies = new Set<string>();
    for (const payload of [
      { token }, // já usado
      { token: expired }, // expirado
      { token: "token-que-nunca-existiu-1234567890" },
      { token: "" },
      { token: "x".repeat(600) },
      { token: 12345 },
      {},
      null,
    ]) {
      const res = await inspect(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(200);
      bodies.add(res.body);
    }
    expect([...bodies]).toEqual(['{"valid":false}']);
  }, 60000);

  async function accountWithToken2() {
    const { credentials } = await registerStore(app, { email: "joao@exemplo.com" });
    await app.inject({ method: "POST", url: "/auth/forgot-password", remoteAddress: nextIp(), payload: { email: credentials.email } });
    await vi.waitFor(() => expect(urls.length).toBe(2));
    const token = tokenOf(urls[1]);
    await prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) }, where: { usedAt: null } });
    return token;
  }

  it("limite de 10 por minuto por IP: o 11º é 429; outro IP segue livre", async () => {
    const same = "10.99.0.1";
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) codes.push((await inspect({ token: "abc" }, same)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
    expect((await inspect({ token: "abc" }, "10.99.0.2")).statusCode).toBe(200);
  }, 60000);

  it("não vira oráculo de conta: o corpo nunca traz id, nome da loja, papel nem o e-mail inteiro", async () => {
    const { token } = await accountWithToken();
    const body = (await inspect({ token })).json();
    expect(Object.keys(body).sort()).toEqual(["email", "valid"]);
    expect(body.email).toMatch(/^.\*\*\*@/);
  }, 60000);
});
