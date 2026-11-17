import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from "@meucardapio/shared-types";
import * as emailLib from "../src/lib/email";
import { makeApp, registerStore, resetDb } from "./helpers";

// SEC-29: senha nova com no mínimo 10 caracteres, SEM exigir composição, em cadastro, convite de equipe, troca e redefinição.
// O LOGIN não tem mínimo: conta antiga com 6 a 9 caracteres continua entrando (a troca é voluntária).

const NINE = "abcdefghi";
const TEN = "abcdefghij"; // 10 letras minúsculas, sem número nem símbolo: tem de ser aceita (nada de regra de composição)

describe("política de senha: mínimo de 10 caracteres (SEC-29)", () => {
  let app: ReturnType<typeof makeApp>;
  let ipSeq = 0;
  const ip = () => `10.55.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

  beforeEach(async () => {
    await resetDb();
    app = makeApp(); // app novo por teste: cadastro e login têm limite por IP e o app guarda o contador
    await app.ready();
  });

  it("a constante é 10 e a mensagem diz 10", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(PASSWORD_TOO_SHORT_MESSAGE).toContain("10");
  });

  it("cadastro: 9 caracteres ⇒ 400 e NADA é criado; 10 só de letras minúsculas ⇒ 201", async () => {
    const base = { storeName: "Loja Política", slug: "loja-politica", code: "LP1", email: "politica@exemplo.com" };
    const short = await app.inject({ method: "POST", url: "/auth/register", remoteAddress: ip(), payload: { ...base, password: NINE } });
    expect(short.statusCode).toBe(400);
    expect(JSON.stringify(short.json())).toContain(PASSWORD_TOO_SHORT_MESSAGE);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.store.count()).toBe(0);

    const ok = await app.inject({ method: "POST", url: "/auth/register", remoteAddress: ip(), payload: { ...base, password: TEN } });
    expect(ok.statusCode).toBe(201);
  });

  it("troca de senha: 9 caracteres ⇒ 400 e a senha NÃO muda; 10 ⇒ 200", async () => {
    const { cookie, credentials } = await registerStore(app);
    const short = await app.inject({ method: "POST", url: "/auth/change-password", remoteAddress: ip(), headers: { cookie: cookie! }, payload: { currentPassword: credentials.password, newPassword: NINE } });
    expect(short.statusCode).toBe(400);
    const stillOld = await app.inject({ method: "POST", url: "/auth/login", remoteAddress: ip(), payload: { email: credentials.email, password: credentials.password } });
    expect(stillOld.statusCode).toBe(200);

    const ok = await app.inject({ method: "POST", url: "/auth/change-password", remoteAddress: ip(), headers: { cookie: cookie! }, payload: { currentPassword: credentials.password, newPassword: TEN } });
    expect(ok.statusCode).toBe(200);
  });

  it("redefinição: 9 caracteres ⇒ 400 e o token NÃO é gasto (dá para tentar de novo com 10); 10 ⇒ 200", async () => {
    const urls: string[] = [];
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async ({ resetUrl }) => {
      urls.push(resetUrl);
    });
    const { credentials } = await registerStore(app);
    await app.inject({ method: "POST", url: "/auth/forgot-password", remoteAddress: ip(), payload: { email: credentials.email } });
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    const token = new URLSearchParams(new URL(urls[0]).hash.slice(1)).get("token")!;

    const short = await app.inject({ method: "POST", url: "/auth/reset-password", remoteAddress: ip(), payload: { token, email: credentials.email, newPassword: NINE } });
    expect(short.statusCode).toBe(400);
    expect(await prisma.passwordResetToken.count({ where: { usedAt: { not: null } } })).toBe(0);

    const ok = await app.inject({ method: "POST", url: "/auth/reset-password", remoteAddress: ip(), payload: { token, email: credentials.email, newPassword: TEN } });
    expect(ok.statusCode).toBe(200);
    vi.restoreAllMocks();
  }, 60000);

  it("convite de equipe: senha de 9 caracteres ⇒ 400 e o funcionário não é criado; 10 ⇒ 201", async () => {
    const { cookie } = await registerStore(app);
    const invite = (password: string, email: string) =>
      app.inject({ method: "POST", url: "/api/users", remoteAddress: ip(), headers: { cookie: cookie! }, payload: { email, password, role: "STAFF" } });
    const short = await invite(NINE, "func9@exemplo.com");
    expect(short.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { email: "func9@exemplo.com" } })).toBe(0);
    const ok = await invite(TEN, "func10@exemplo.com");
    expect(ok.statusCode).toBe(201);
  });

  it("LOGIN não tem mínimo: conta antiga com senha de 6 caracteres continua entrando (ninguém é forçado a trocar)", async () => {
    const { credentials } = await registerStore(app);
    const legacy = "velha6";
    await prisma.user.update({ where: { email: credentials.email }, data: { passwordHash: await bcrypt.hash(legacy, 4) } });
    const res = await app.inject({ method: "POST", url: "/auth/login", remoteAddress: ip(), payload: { email: credentials.email, password: legacy } });
    expect(res.statusCode).toBe(200);
  }, 60000);

  it("sem regra de composição: letras repetidas, frase só de minúsculas e 200 caracteres são aceitas; 201 é recusado", async () => {
    // por CADASTRO (cada um é uma conta nova, sem depender de sessão que a troca de senha derruba)
    let n = 0;
    for (const password of ["aaaaaaaaaa", "uma frase longa so de letras minusculas", "x".repeat(200)]) {
      n += 1;
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        remoteAddress: ip(),
        payload: { storeName: `Loja ${n}`, slug: `loja-composicao-${n}`, code: `CP${n}`, email: `composicao${n}@exemplo.com`, password },
      });
      expect(res.statusCode, password.slice(0, 12)).toBe(201);
    }
    const tooLong = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: ip(),
      payload: { storeName: "Loja 4", slug: "loja-composicao-4", code: "CP4", email: "composicao4@exemplo.com", password: "x".repeat(201) },
    });
    expect(tooLong.statusCode).toBe(400);
  }, 120000);
});
