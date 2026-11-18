// QA-22 — critérios do SEC-20 / NG-05 (ADR-0008 §8): ST-32 reserva atômica da tentativa de login, ST-33 sem bloqueio duro por conta
// (o dono entra de um IP novo) e ST-34 e-mail sem diferenciar caixa. Escritas contra o desenho FINAL aprovado pelo Atlas e pelo
// Sun Tzu: limite estrito por par (conta, IP); o total da conta só atrasa/avisa, nunca tranca.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

const LIMITE_POR_PAR = 5; // LoginThrottle.pairAttempts

describe("QA login e cadastro (SEC-20)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  const login = (email: string, password: string, ip: string) =>
    app.inject({ method: "POST", url: "/auth/login", remoteAddress: ip, payload: { email, password } });

  it("L1 (ST-32) 60 tentativas PARALELAS do mesmo IP contra a mesma conta: só o limite do par chega a testar a senha, o resto é 429", async () => {
    const { credentials } = await registerStore(app, { email: "dono-alvo@teste.com", password: "senha-certa-123" });
    const tentativas = await Promise.all(Array.from({ length: 60 }, (_, i) => login(credentials.email, `errada-${i}`, "10.20.0.1")));
    const testaramSenha = tentativas.filter((r) => r.statusCode === 401).length; // 401 = a senha chegou a ser conferida
    const barradas = tentativas.filter((r) => r.statusCode === 429).length;
    expect(testaramSenha + barradas, "toda resposta é 401 ou 429 (nunca 5xx nem 200)").toBe(60);
    expect(testaramSenha).toBeLessThanOrEqual(LIMITE_POR_PAR);
  });

  it("L1b (ST-32) a SENHA CERTA em rajada paralela também respeita o limite do par (a reserva conta mesmo que a senha esteja certa)", async () => {
    const { credentials } = await registerStore(app, { email: "dono-rajada@teste.com", password: "senha-certa-123" });
    const r = await Promise.all(Array.from({ length: 20 }, () => login(credentials.email, "senha-certa-123", "10.21.0.1")));
    expect(r.filter((x) => x.statusCode === 200).length).toBeLessThanOrEqual(LIMITE_POR_PAR);
    expect(r.filter((x) => x.statusCode === 200 || x.statusCode === 429).length).toBe(20);
  });

  it("L2 (controle) sequencial: depois de estourar o limite do par, a senha CERTA daquele par também é recusada (429) com Retry-After", async () => {
    const { credentials } = await registerStore(app, { email: "dono-seq@teste.com", password: "senha-certa-123" });
    for (let i = 0; i < 6; i++) await login(credentials.email, `errada-${i}`, "10.30.0.1");
    const certa = await login(credentials.email, "senha-certa-123", "10.30.0.1");
    expect(certa.statusCode).toBe(429);
    expect(Number(certa.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("L2b (ST-33) o dono NÃO fica trancado: depois de 40 erros de 20 IPs diferentes, a senha certa de um IP NOVO entra", async () => {
    const { credentials } = await registerStore(app, { email: "dono-vitima@teste.com", password: "senha-certa-123" });
    await Promise.all(Array.from({ length: 40 }, (_, i) => login(credentials.email, `errada-${i}`, `10.40.0.${(i % 20) + 1}`)));
    const dono = await login(credentials.email, "senha-certa-123", "10.99.0.1");
    expect(dono.statusCode).toBe(200);
  }, 60_000);

  it("L2c (ST-05) o 429 é idêntico para conta real e para e-mail inventado (não revela se a conta existe)", async () => {
    const { credentials } = await registerStore(app, { email: "dono-existe@teste.com", password: "senha-certa-123" });
    const estourar = async (email: string, ip: string) => {
      let ultima = await login(email, "errada", ip);
      for (let i = 0; i < 6; i++) ultima = await login(email, `errada-${i}`, ip);
      return ultima;
    };
    const real = await estourar(credentials.email, "10.50.0.1");
    const falsa = await estourar("ninguem-aqui@teste.com", "10.50.0.2");
    expect(real.statusCode).toBe(429);
    expect(falsa.statusCode).toBe(429);
    expect(JSON.parse(real.body)).toEqual(JSON.parse(falsa.body));
  });

  it("L3 (ST-34) e-mail com outra caixa NÃO cria 2ª conta: 'Dono@X.com' e 'dono@x.com' são a mesma conta", async () => {
    const primeiro = await registerStore(app, { email: "dono.caixa@teste.com" });
    expect(primeiro.response.statusCode).toBe(201);
    const segundo = await registerStore(app, { email: "DONO.Caixa@Teste.com" });
    expect(segundo.response.statusCode).toBe(409);
    expect(await prisma.user.count({ where: { email: { equals: "dono.caixa@teste.com", mode: "insensitive" } } })).toBe(1);
  });

  it("L3b (B21) 8 cadastros iguais em paralelo (IPs distintos, para não cair no limite de 5/min por IP): exatamente 1 vence e nenhum responde 500", async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      app.inject({ method: "POST", url: "/auth/register", remoteAddress: `10.70.0.${i + 1}`, payload: { storeName: `Loja ${i}`, slug: `loja-par-${i}`, code: `P${i}`, email: "paralelo@teste.com", password: "senha12345" } })));
    expect(rs.filter((r) => r.statusCode >= 500).length, rs.map((r) => r.statusCode).join(",")).toBe(0);
    expect(rs.filter((r) => r.statusCode === 201).length).toBe(1);
    expect(await prisma.user.count({ where: { email: { equals: "paralelo@teste.com", mode: "insensitive" } } })).toBe(1);
  });

  it("L4 (ST-34) o login aceita o e-mail em qualquer caixa e com espaços nas pontas", async () => {
    const { credentials } = await registerStore(app, { email: "dono.login@teste.com", password: "senha-certa-123" });
    const r = await login(`  ${credentials.email.toUpperCase()} `, "senha-certa-123", "10.60.0.1");
    expect(r.statusCode).toBe(200);
  });
});
