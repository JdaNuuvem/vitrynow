import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as emailLib from "../src/lib/email";
import { RESET_COOLDOWN_MS, RESET_MAX_PER_HOUR, issueResetToken } from "../src/lib/passwordReset";
import { makeApp, registerStore, resetDb } from "./helpers";

// SEC-28 (ST-57, ST-58, ST-62; Sun Tzu): o "esqueci a senha" (1) não revela por TEMPO se a conta existe, (2) tem limite POR CONTA, silencioso,
// (3) mantém um só token ativo e (4) não escreve o e-mail inteiro em log de erro.

const SEND_DELAY_MS = 700; // o envio real ao provedor leva centenas de ms; em teste ele seria instantâneo e esconderia o oráculo (tem de ser MAIOR que o piso de 350 ms)
let ipSeq = 0;
const nextIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`; // o limite por IP da rota (5/min) não pode atrapalhar

describe("forgot-password: tempo igual, limite por conta e um token ativo (SEC-28)", () => {
  // App NOVO por teste: o cadastro de loja tem limite por IP (5/min) e o app guarda esse contador; sem isto o 6º cadastro do arquivo falha.
  let app: ReturnType<typeof makeApp>;
  const sent: { to: string; resetUrl: string }[] = [];
  let sendImpl: (input: { to: string; resetUrl: string }) => Promise<void>;

  beforeEach(async () => {
    await resetDb();
    app = makeApp();
    sent.length = 0;
    sendImpl = async (input) => {
      sent.push(input);
      await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
    };
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation((input) => sendImpl(input));
    await app.ready();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDb(); // o último teste do arquivo não pode deixar loja/usuário para o vizinho (409 EMAIL_IN_USE/STORE_IN_USE)
  });

  const forgot = (email: string) => app.inject({ method: "POST", url: "/auth/forgot-password", remoteAddress: nextIp(), payload: { email } });
  const activeTokens = (userId: string) => prisma.passwordResetToken.count({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } } });
  const tokenOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;

  // ST-57 (tempo igual para conta existente, inexistente e limitada) mudou para tests/forgot-password-tempo.test.ts (SEC-39): é teste de tempo e roda no estágio isolado, com amostras entrelaçadas.

  it("ST-58: 20 pedidos seguidos para a MESMA conta ⇒ no máximo 1 envio e 1 token ativo (o resto é silencioso e igual)", async () => {
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    const bodies = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const res = await forgot(credentials.email);
      expect(res.statusCode).toBe(200);
      bodies.add(res.body);
    }
    expect(bodies.size).toBe(1);
    expect(sent.length).toBeLessThanOrEqual(RESET_MAX_PER_HOUR);
    expect(sent).toHaveLength(1);
    expect(await activeTokens(user.id)).toBe(1);
  }, 60000);

  it("ST-58: pedidos SIMULTÂNEOS para a mesma conta não furam o limite (o lock da conta serializa)", async () => {
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    const results = await Promise.all(Array.from({ length: 12 }, () => issueResetToken(credentials.email)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await activeTokens(user.id)).toBe(1);
  }, 60000);

  it("ST-58: passados os 60 s entra um token NOVO e o anterior morre (um só ativo); no 4º pedido da hora o limite fecha, em silêncio", async () => {
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    const backdate = async (ms: number) =>
      prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - ms) } });

    await forgot(credentials.email);
    const first = tokenOf(sent[0].resetUrl);
    expect(await activeTokens(user.id)).toBe(1);

    await backdate(RESET_COOLDOWN_MS + 5_000);
    await forgot(credentials.email);
    expect(sent).toHaveLength(2);
    const second = tokenOf(sent[1].resetUrl);
    expect(second).not.toBe(first);
    expect(await activeTokens(user.id)).toBe(1); // só o novo está ativo

    // o token antigo NÃO redefine mais a senha; o novo redefine
    const old = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token: first, email: credentials.email, newPassword: "outraSenha123" } });
    expect(old.statusCode).toBeGreaterThanOrEqual(400);

    await backdate(RESET_COOLDOWN_MS + 5_000);
    await forgot(credentials.email);
    expect(sent).toHaveLength(3);

    await backdate(RESET_COOLDOWN_MS + 5_000);
    const fourth = await forgot(credentials.email); // 3 pedidos na última hora: fechado
    expect(fourth.statusCode).toBe(200);
    expect(sent).toHaveLength(RESET_MAX_PER_HOUR);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(RESET_MAX_PER_HOUR);

    const fresh = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token: tokenOf(sent[2].resetUrl), email: credentials.email, newPassword: "outraSenha123" } });
    expect(fresh.statusCode).toBe(200);
  }, 60000);

  it("a hora seguinte reabre o limite (os pedidos antigos saem da janela)", async () => {
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    for (let i = 0; i < RESET_MAX_PER_HOUR; i += 1) {
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: `h-${i}-${Date.now()}`, expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 30 * 60_000) } });
    }
    expect(await issueResetToken(credentials.email)).toBeNull(); // 3 na última hora
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 61 * 60_000) } });
    expect(await issueResetToken(credentials.email)).not.toBeNull();
  }, 60000);

  it("falha do provedor de e-mail não muda a resposta e não derruba o processo (sem rejeição solta)", async () => {
    const { credentials } = await registerStore(app);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    sendImpl = async () => {
      throw new Error("provedor fora do ar");
    };
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args.join(" ")));
    const res = await forgot(credentials.email);
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off("unhandledRejection", unhandled);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(unhandled).not.toHaveBeenCalled();
    // ST-62: o log de erro leva o e-mail MASCARADO e não a mensagem do erro
    const line = errors.join("\n");
    expect(line).toContain("falha ao enviar recuperação de senha");
    expect(line).not.toContain(credentials.email);
    expect(line).toContain(emailLib.maskEmail(credentials.email));
  }, 60000);
});

describe("maskEmail (ST-62)", () => {
  it("mantém a 1ª letra e o domínio; endereço sem @ vira ***", () => {
    expect(emailLib.maskEmail("maria.silva@exemplo.com.br")).toBe("m***@exemplo.com.br");
    expect(emailLib.maskEmail("a@b.co")).toBe("a***@b.co");
    expect(emailLib.maskEmail("sem-arroba")).toBe("***");
    expect(emailLib.maskEmail("")).toBe("***");
    expect(emailLib.maskEmail("@so-dominio.com")).toBe("***");
  });
});
