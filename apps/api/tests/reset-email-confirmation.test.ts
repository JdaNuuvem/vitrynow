import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as emailLib from "../src/lib/email";
import { RESET_FAIL_MIN_DURATION_MS, RESET_MAX_EMAIL_FAILURES, resetHooks } from "../src/lib/passwordReset";
import { hashToken } from "../src/lib/tokenHash";
import { makeApp, registerStore, resetDb } from "./helpers";

// SEC-29 (ST-67, Sun Tzu): o link de redefinição só vale se quem o usa DIGITAR o e-mail da conta do token. O e-mail mascarado sozinho
// não distingue maria@gmail.com de mallory@gmail.com (os dois viram m***@gmail.com). Cenário: o atacante pede a redefinição da conta DELE e
// manda o link à vítima; a vítima digita o e-mail DELA e o servidor recusa.

describe("redefinição de senha exige o e-mail da conta do token (SEC-29, ST-67)", () => {
  let app: ReturnType<typeof makeApp>;
  let ipSeq = 0;
  const ip = () => `10.66.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  const reset = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/auth/reset-password", remoteAddress: ip(), payload: payload as never });

  async function accountWithToken(email: string) {
    const urls: string[] = [];
    const spy = vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async ({ resetUrl }) => {
      urls.push(resetUrl);
    });
    const { credentials } = await registerStore(app, { email });
    await app.inject({ method: "POST", url: "/auth/forgot-password", remoteAddress: ip(), payload: { email: credentials.email } });
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    spy.mockRestore();
    return { credentials, token: new URLSearchParams(new URL(urls[0]).hash.slice(1)).get("token")! };
  }
  const unusedActive = (token: string) => prisma.passwordResetToken.count({ where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() } } });

  beforeEach(async () => {
    await resetDb();
    app = makeApp();
    await app.ready();
  });

  it("token da conta A + e-mail da conta B ⇒ recusado, o token NÃO é gasto e continua válido (o dono ainda o usa)", async () => {
    const a = await accountWithToken("mallory@exemplo.com");
    const victim = await registerStore(app, { email: "maria@exemplo.com" });

    const refused = await reset({ token: a.token, email: victim.credentials.email, newPassword: "senha-nova-da-vitima" });
    expect(refused.statusCode).toBe(400);
    expect(await unusedActive(a.token)).toBe(1);
    // a senha da conta A NÃO mudou
    const stillOld = await app.inject({ method: "POST", url: "/auth/login", remoteAddress: ip(), payload: { email: a.credentials.email, password: a.credentials.password } });
    expect(stillOld.statusCode).toBe(200);

    // com o e-mail certo o mesmo token funciona
    const ok = await reset({ token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
    expect(ok.statusCode).toBe(200);
    expect(await unusedActive(a.token)).toBe(0);
  }, 60000);

  it("e-mail da conta com outra caixa e com espaços nas pontas ⇒ aceito", async () => {
    const a = await accountWithToken("Maria.Silva@Exemplo.com");
    expect(a.credentials.email).toBeTruthy();
    const ok = await reset({ token: a.token, email: "  MARIA.SILVA@exemplo.COM  ", newPassword: "senha-nova-do-dono" });
    expect(ok.statusCode).toBe(200);
  }, 60000);

  it("SEM o campo e-mail (bundle antigo em cache), e-mail vazio ou malformado ⇒ a MESMA recusa genérica, o token não é gasto e o e-mail nunca é opcional", async () => {
    const a = await accountWithToken("dono@exemplo.com");
    const generic = await reset({ token: "w".repeat(32), email: "qualquer@exemplo.com", newPassword: "senha-nova-do-dono" }); // token inexistente
    const bodies = new Set<string>([generic.body]);
    for (const payload of [{ token: a.token, newPassword: "senha-nova-do-dono" }, { token: a.token, email: "", newPassword: "senha-nova-do-dono" }, { token: a.token, email: "nao-e-email", newPassword: "senha-nova-do-dono" }]) {
      const res = await reset(payload);
      expect(res.statusCode).toBe(400);
      bodies.add(res.body);
    }
    expect(bodies.size).toBe(1);
    expect(await unusedActive(a.token)).toBe(1);
    // e a senha curta continua com o erro de validação próprio (não depende do token)
    const short = await reset({ token: a.token, email: a.credentials.email, newPassword: "curta" });
    expect(short.statusCode).toBe(400);
    expect(short.body).not.toBe(generic.body);
  }, 60000);

  it("MESMA resposta (status e corpo) para e-mail errado, token inexistente, token usado e token vencido", async () => {
    const a = await accountWithToken("a@exemplo.com");
    const b = await accountWithToken("b@exemplo.com");
    // token vencido
    await prisma.passwordResetToken.updateMany({ where: { tokenHash: hashToken(b.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    // token usado
    const c = await accountWithToken("c@exemplo.com");
    expect((await reset({ token: c.token, email: c.credentials.email, newPassword: "senha-nova-do-dono" })).statusCode).toBe(200);

    const responses = [
      await reset({ token: a.token, email: "outra-pessoa@exemplo.com", newPassword: "senha-nova-da-vitima" }), // e-mail errado
      await reset({ token: "x".repeat(32), email: a.credentials.email, newPassword: "senha-nova-da-vitima" }), // token inexistente
      await reset({ token: c.token, email: c.credentials.email, newPassword: "senha-nova-da-vitima" }), // usado
      await reset({ token: b.token, email: b.credentials.email, newPassword: "senha-nova-da-vitima" }), // vencido
    ];
    expect(new Set(responses.map((r) => r.statusCode))).toEqual(new Set([400]));
    expect(new Set(responses.map((r) => r.body)).size).toBe(1);
    expect(new Set(responses.map((r) => JSON.stringify(Object.keys(r.headers).filter((h) => /^(x-|retry-after)/.test(h)).sort()))).size).toBe(1);
  }, 120000);

  it("MESMO tempo nas três recusas: diferença entre as medianas < 35 ms e todas no piso", async () => {
    const a = await accountWithToken("tempo@exemplo.com");
    const sample = async (payload: Record<string, unknown>, n = 5) => {
      const ms: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const t0 = performance.now();
        await reset(payload);
        ms.push(performance.now() - t0);
      }
      return [...ms].sort((x, y) => x - y)[Math.floor(ms.length / 2)];
    };
    const wrongEmail = await sample({ token: a.token, email: "errado@exemplo.com", newPassword: "senha-nova-da-vitima" }, 3); // só 3: 5 invalidam o token
    const noToken = await sample({ token: "y".repeat(32), email: a.credentials.email, newPassword: "senha-nova-da-vitima" });
    const empty = await sample({ token: "z", email: a.credentials.email, newPassword: "senha-nova-da-vitima" });
    expect(Math.abs(wrongEmail - noToken)).toBeLessThan(35);
    expect(Math.abs(noToken - empty)).toBeLessThan(35);
    for (const value of [wrongEmail, noToken, empty]) expect(value).toBeGreaterThanOrEqual(RESET_FAIL_MIN_DURATION_MS - 10);
  }, 120000);

  it(`${RESET_MAX_EMAIL_FAILURES} e-mails errados INVALIDAM o token, com a mesma resposta; depois nem o e-mail certo o reabre`, async () => {
    const a = await accountWithToken("brute@exemplo.com");
    const bodies = new Set<string>();
    for (let i = 0; i < RESET_MAX_EMAIL_FAILURES; i += 1) {
      const res = await reset({ token: a.token, email: `chute${i}@exemplo.com`, newPassword: "senha-nova-da-vitima" });
      expect(res.statusCode).toBe(400);
      bodies.add(res.body);
      if (i < RESET_MAX_EMAIL_FAILURES - 1) expect(await unusedActive(a.token)).toBe(1); // ainda vale até o último chute
    }
    expect(await unusedActive(a.token)).toBe(0);
    const after = await reset({ token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
    expect(after.statusCode).toBe(400);
    bodies.add(after.body);
    expect(bodies.size).toBe(1);
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { tokenHash: hashToken(a.token) } });
    expect(row.usedAt).toBeNull(); // invalidado, nunca "usado"
    expect(row.emailFailures).toBe(RESET_MAX_EMAIL_FAILURES);
  }, 120000);

  it("e-mail errado em token de OUTRA conta não conta falha no token de quem acertou (contador é por token)", async () => {
    const a = await accountWithToken("um@exemplo.com");
    const b = await accountWithToken("dois@exemplo.com");
    for (let i = 0; i < 3; i += 1) await reset({ token: a.token, email: "errado@exemplo.com", newPassword: "senha-nova-da-vitima" });
    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { tokenHash: hashToken(b.token) } })).emailFailures).toBe(0);
    expect((await reset({ token: b.token, email: b.credentials.email, newPassword: "senha-nova-do-dono" })).statusCode).toBe(200);
  }, 120000);

  // ST-68 (Sun Tzu, mesma classe do ST-32): a decisão tem de sair NO BANCO, numa instrução. O pedido CERTO é atrasado só no bcrypt, depois de ler
  // o token como "vivo" e o e-mail como certo; enquanto isso 30 pedidos errados gravam as falhas e o token morre na 5ª. Se a decisão fosse
  // tomada com a leitura velha (antes do UPDATE), o certo passaria mesmo com 5 falhas já gravadas.
  it("ST-68: rajada de 30 e-mails errados + o CERTO por último (lendo o token antes de as falhas serem gravadas) ⇒ o certo é RECUSADO", async () => {
    const a = await accountWithToken("rajada@exemplo.com");
    // o pedido CERTO lê o token "vivo" e o e-mail certo e ESPERA aqui; enquanto isso os 30 errados gravam as falhas e o token morre na 5ª
    resetHooks.beforeClaim = async ({ email }) => {
      if (email === a.credentials.email) await new Promise((resolve) => setTimeout(resolve, 800));
    };
    try {
      const wrong = Array.from({ length: 30 }, (_, i) => reset({ token: a.token, email: `chute${i}@exemplo.com`, newPassword: "senha-nova-da-vitima" }));
      await new Promise((resolve) => setTimeout(resolve, 30)); // os errados já leram o token; o certo chega logo depois e também lê "vivo"
      const right = reset({ token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
      const [rightRes] = await Promise.all([right, ...wrong]);
      expect(rightRes.statusCode).toBe(400); // vulnerável (antes do conserto): 200
    } finally {
      resetHooks.beforeClaim = undefined;
    }
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { tokenHash: hashToken(a.token) } });
    expect(row.usedAt).toBeNull();
    expect(row.emailFailures).toBe(RESET_MAX_EMAIL_FAILURES); // o contador parou na 5ª: o resto nem o toca
    const login = await app.inject({ method: "POST", url: "/auth/login", remoteAddress: ip(), payload: { email: a.credentials.email, password: a.credentials.password } });
    expect(login.statusCode).toBe(200); // a senha NÃO mudou
  }, 120000);

  it("tempo: e-mail CERTO contra token já MORTO tem a mesma duração das outras recusas (a recusa nunca paga o bcrypt)", async () => {
    const a = await accountWithToken("morto@exemplo.com");
    await prisma.passwordResetToken.updateMany({ where: { tokenHash: hashToken(a.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const hashSpy = vi.spyOn(bcrypt, "hash");
    const sample = async (payload: Record<string, unknown>) => {
      const ms: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const t0 = performance.now();
        await reset(payload);
        ms.push(performance.now() - t0);
      }
      return [...ms].sort((x, y) => x - y)[2];
    };
    const rightEmailDeadToken = await sample({ token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
    const wrongEmailDeadToken = await sample({ token: a.token, email: "outro@exemplo.com", newPassword: "senha-nova-do-dono" });
    expect(hashSpy).not.toHaveBeenCalled(); // nenhuma recusa chegou ao bcrypt
    hashSpy.mockRestore();
    expect(Math.abs(rightEmailDeadToken - wrongEmailDeadToken)).toBeLessThan(35);
  }, 120000);

  it("ST-68: dois pedidos CERTOS ao mesmo tempo ⇒ exatamente UM redefine (o token não é usado 2×) e a senha muda uma vez só", async () => {
    const a = await accountWithToken("duplo@exemplo.com");
    const before = await prisma.user.findUniqueOrThrow({ where: { email: a.credentials.email }, select: { tokenVersion: true } });
    const results = await Promise.all([
      reset({ token: a.token, email: a.credentials.email, newPassword: "primeira-senha-nova" }),
      reset({ token: a.token, email: a.credentials.email, newPassword: "segunda-senha-nova-" }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    const after = await prisma.user.findUniqueOrThrow({ where: { email: a.credentials.email }, select: { tokenVersion: true } });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
  }, 120000);

  it("ST-68: contador já em 5 com o token ainda no prazo (estado inconsistente) ⇒ nem o e-mail CERTO passa (o WHERE do banco também confere o contador)", async () => {
    const a = await accountWithToken("esgotado@exemplo.com");
    await prisma.passwordResetToken.updateMany({ where: { tokenHash: hashToken(a.token) }, data: { emailFailures: RESET_MAX_EMAIL_FAILURES } });
    expect(await unusedActive(a.token)).toBe(1);
    const res = await reset({ token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
    expect(res.statusCode).toBe(400);
    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { tokenHash: hashToken(a.token) } })).usedAt).toBeNull();
  }, 60000);

  it("troca da senha e consumo do token são UMA transação: se a troca falhar, o token continua válido (nada de token queimado sem senha nova)", async () => {
    const a = await accountWithToken("atomico@exemplo.com");
    // falha REAL do banco dentro da transação: uma restrição temporária que o `tokenVersion + 1` da troca de senha viola
    await prisma.user.update({ where: { email: a.credentials.email }, data: { tokenVersion: 4 } });
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD CONSTRAINT "zz_ng_atomico" CHECK ("tokenVersion" < 5)`);
    try {
      const res = await reset({ token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(await unusedActive(a.token)).toBe(1); // o consumo do token foi desfeito junto
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "zz_ng_atomico"`);
    }
    const retry = await reset({ token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
    expect(retry.statusCode).toBe(200);
  }, 120000);
});
