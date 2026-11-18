import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { buildApp } from "../src/app";
import { loggerOptions } from "../src/lib/logging";
import { resetDb } from "./helpers";

// NG-11 (D-T4/D1-5): teste que PROCURA segredo de teste em todo o log. Sobe o app com o logger REAL (serializers, redact e formatadores de produção) e manda valores-CANÁRIO
// por todos os canais (cabeçalho, cookie, query e corpo) em rotas que falham ou nem existem; nenhum canário pode aparecer no log.

const CANARIOS = {
  senha: "CANARIO-SENHA-7f3a91",
  senhaNova: "CANARIO-NOVASENHA-2b8c40",
  tokenReset: "CANARIO-RESET-9d1e55",
  auth: "CANARIO-AUTH-4c6a12",
  cookie: "CANARIO-COOKIE-a81f07",
  tokenPedido: "CANARIO-PEDIDO-33be90",
  mfa: "CANARIO-MFA-5e2d68",
  servico: "CANARIO-SERVICO-c7410b",
  queryToken: "CANARIO-QTOKEN-0f9a2e",
  queryCode: "CANARIO-QCODE-6b73d1",
  queryState: "CANARIO-QSTATE-e5280c",
  querySenha: "CANARIO-QSENHA-18d4f6",
  dispositivo: "CANARIO-DISP-b92e47",
  corpoToken: "CANARIO-CORPOTOKEN-71a3c5",
  corpoSegredo: "CANARIO-CLIENTSECRET-d04e8a",
};

describe("NG-11: nenhum segredo (canário) chega ao log", () => {
  const lines: string[] = [];
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    await resetDb();
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    app = buildApp({ logger: { ...loggerOptions(), level: "trace", stream } as never });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await resetDb(); // não deixa loja/usuário para o próximo arquivo (o mfa-notices só limpa DEPOIS de cada teste)
    await prisma.$disconnect();
  });

  it("login errado, reset, callback do OAuth, rota inexistente e chave de impressora recusada com canários em cabeçalho, cookie, query e corpo", async () => {
    const headers = {
      authorization: `Bearer ${CANARIOS.auth}`,
      cookie: `mc_session=${CANARIOS.cookie}`,
      "x-order-token": CANARIOS.tokenPedido,
      "x-mfa-challenge": CANARIOS.mfa,
      "x-internal-service-secret": CANARIOS.servico,
    };
    const query = `token=${CANARIOS.queryToken}&code=${CANARIOS.queryCode}&state=${CANARIOS.queryState}&password=${CANARIOS.querySenha}`;

    await app.inject({ method: "POST", url: "/auth/login", headers, payload: { email: "ninguem@exemplo.com", password: CANARIOS.senha } });
    await app.inject({ method: "POST", url: "/auth/reset-password", headers, payload: { token: CANARIOS.tokenReset, email: "ninguem@exemplo.com", newPassword: CANARIOS.senhaNova } });
    await app.inject({ method: "POST", url: "/auth/forgot-password", headers, payload: { email: "ninguem@exemplo.com" } });
    await app.inject({ method: "GET", url: `/rota-que-nao-existe?${query}`, headers });
    await app.inject({ method: "GET", url: `/api/store/payments/mercadopago/callback?${query}`, headers });
    await app.inject({ method: "GET", url: `/api/orders?${query}`, headers });
    await app.inject({ method: "POST", url: "/api/payments/webhook", headers, payload: { type: "payment", data: { id: CANARIOS.corpoToken }, client_secret: CANARIOS.corpoSegredo, access_token: CANARIOS.corpoToken } });
    await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: { authorization: `Bearer ${CANARIOS.dispositivo}` } });
    await app.inject({ method: "POST", url: "/api/mfa/verify", headers, payload: { challengeId: CANARIOS.mfa, code: "123456" } });
    // corpo malformado também passa pelo tratamento de erro (JSON inválido carrega o texto original em alguns erros)
    await app.inject({ method: "POST", url: "/auth/login", headers: { ...headers, "content-type": "application/json" }, payload: `{"email":"x","password":"${CANARIOS.senha}"` });
    await new Promise((resolve) => setTimeout(resolve, 100)); // o pino escreve no próximo tick

    const log = lines.join("");
    // controle positivo: o log NÃO está vazio e traz o que deve trazer (senão o teste passaria por não ter log nenhum)
    expect(lines.length, "o logger capturou linhas").toBeGreaterThan(10);
    expect(log).toContain("incoming request");
    expect(log).toContain("request completed");
    // nenhum canário, em nenhum formato
    const vazou = Object.entries(CANARIOS).filter(([, valor]) => log.includes(valor)).map(([nome]) => nome);
    expect(vazou, `canários que apareceram no log: ${vazou.join(", ")}`).toEqual([]);
    expect(log).not.toMatch(/CANARIO-/);
  }, 60000);
});
