import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as emailLib from "../src/lib/email";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

// NG-17 (ST-56, Sun Tzu): o que o usuário recebe por e-mail para recuperar a conta (link de redefinição, código de confirmação) não pode
// parar em log: `docker logs` e o coletor de logs leriam e tomariam a conta. Dois cortes:
//  1) o link leva o token no FRAGMENTO (#), que o navegador nunca envia ao servidor (nem ao log de acesso, nem ao Referer);
//  2) sem RESEND_API_KEY, o "modo sem chave" só escreve o conteúdo do e-mail em desenvolvimento/teste.

const SECRET_LINK = "https://loja.exemplo/reset-senha#token=TOKEN-SECRETO-DE-RESET";
const saved = { ...process.env };

describe("o conteúdo do e-mail de recuperação não vai para o log fora de dev/teste (NG-17)", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_LOG_LINKS;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  function captured() {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args) => void lines.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => void lines.push(args.join(" ")));
    vi.spyOn(console, "log").mockImplementation((...args) => void lines.push(args.join(" ")));
    return lines;
  }

  it("produção, staging e NODE_ENV ausente: nem o link nem o código aparecem; sai um erro claro, sem segredo", async () => {
    for (const env of ["production", "prod", "staging", undefined]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      const lines = captured();
      await emailLib.sendPasswordResetEmail({ to: "dono@exemplo.com", resetUrl: SECRET_LINK });
      await emailLib.sendMfaCodeEmail({ to: "dono@exemplo.com", code: "987654", purposeLabel: "troca de senha" });
      const all = lines.join("\n");
      expect(all, String(env)).not.toContain("TOKEN-SECRETO-DE-RESET");
      expect(all, String(env)).not.toContain("987654");
      expect(all, String(env)).toMatch(/NÃO foi enviado/);
      vi.restoreAllMocks();
    }
  });

  it("CONTROLE POSITIVO: em development e test (e com EMAIL_LOG_LINKS=true) o link e o código continuam saindo no log para quem desenvolve", async () => {
    for (const setup of [{ NODE_ENV: "development" }, { NODE_ENV: "test" }, { NODE_ENV: "production", EMAIL_LOG_LINKS: "true" }]) {
      Object.assign(process.env, setup);
      const lines = captured();
      await emailLib.sendPasswordResetEmail({ to: "dono@exemplo.com", resetUrl: SECRET_LINK });
      await emailLib.sendMfaCodeEmail({ to: "dono@exemplo.com", code: "987654", purposeLabel: "troca de senha" });
      const all = lines.join("\n");
      expect(all, JSON.stringify(setup)).toContain("TOKEN-SECRETO-DE-RESET");
      expect(all, JSON.stringify(setup)).toContain("987654");
      vi.restoreAllMocks();
      delete process.env.EMAIL_LOG_LINKS;
    }
  });
});

describe("o link de redefinição leva o token no fragmento, não na query (NG-17)", () => {
  const app = makeApp();
  const urls: string[] = [];

  beforeEach(async () => {
    await resetDb();
    urls.length = 0;
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async ({ resetUrl }) => {
      urls.push(resetUrl);
    });
    await app.ready();
  });
  afterEach(() => vi.restoreAllMocks());

  it("forgot-password monta /reset-senha#token=… sem '?' e sem o token na query; o token do fragmento redefine a senha", async () => {
    const { credentials } = await registerStore(app);

    const res = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: credentials.email } });
    expect(res.statusCode).toBe(200);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]);
    expect(url.pathname).toBe("/reset-senha");
    expect(url.search).toBe(""); // nada na query: o log de acesso e o Referer nunca veem o token
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    expect(token).toHaveLength(32);

    const reset = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token, email: credentials.email, newPassword: "outraSenha123" } });
    expect(reset.statusCode).toBe(200);
    expect(await prisma.passwordResetToken.count({ where: { usedAt: { not: null } } })).toBe(1);
  });
});
