import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { LoginThrottle } from "../src/lib/loginThrottle";
import { makeApp, registerStore, resetDb } from "./helpers";

// ───────────── Unitário: bloqueio progressivo (relógio falso, sem banco) ─────────────
describe("LoginThrottle (NG-05, ST-03)", () => {
  const MIN = 60_000;
  function setup(limits = { account: 12, accountIp: 5 }) {
    let t = 1_000_000;
    const throttle = new LoginThrottle(limits, () => t);
    return { throttle, advance: (ms: number) => void (t += ms) };
  }
  const fails = (th: LoginThrottle, email: string, ip: string, n: number) => {
    for (let i = 0; i < n; i++) th.fail(email, ip);
  };

  it("5 falhas da mesma conta no mesmo IP bloqueiam por 1 min e o bloqueio some sozinho", () => {
    const { throttle, advance } = setup();
    fails(throttle, "a@x.com", "1.1.1.1", 4);
    expect(throttle.check("a@x.com", "1.1.1.1").allowed).toBe(true);
    fails(throttle, "a@x.com", "1.1.1.1", 1);
    const d = throttle.check("a@x.com", "1.1.1.1");
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.retryAfterSeconds).toBe(60);
    advance(MIN + 1);
    expect(throttle.check("a@x.com", "1.1.1.1").allowed).toBe(true);
  });

  it("o bloqueio dobra a cada estouro e tem teto de 15 min", () => {
    const { throttle, advance } = setup();
    const waits: number[] = [];
    for (let round = 0; round < 7; round++) {
      fails(throttle, "a@x.com", "1.1.1.1", 5);
      const d = throttle.check("a@x.com", "1.1.1.1");
      expect(d.allowed).toBe(false);
      if (!d.allowed) {
        waits.push(d.retryAfterSeconds);
        advance(d.retryAfterSeconds * 1000 + 1);
      }
    }
    expect(waits).toEqual([60, 120, 240, 480, 900, 900, 900]);
  });

  it("outro IP não é trancado pelo limite de conta+IP, mas 12 falhas na conta trancam todos (distribuído)", () => {
    const { throttle } = setup();
    fails(throttle, "a@x.com", "1.1.1.1", 5);
    expect(throttle.check("a@x.com", "1.1.1.1").allowed).toBe(false);
    expect(throttle.check("a@x.com", "2.2.2.2").allowed).toBe(true);

    const d = setup();
    for (let i = 0; i < 12; i++) d.throttle.fail("alvo@x.com", `9.9.9.${i}`); // 12 IPs diferentes, 1 falha cada
    expect(d.throttle.check("alvo@x.com", "9.9.9.200").allowed).toBe(false);
    expect(d.throttle.check("outra@x.com", "9.9.9.200").allowed).toBe(true);
  });

  it("e-mail inexistente é tratado igual a existente (não revela a conta) e maiúsculas não contornam", () => {
    const { throttle } = setup();
    fails(throttle, "Ninguem@X.com", "1.1.1.1", 5);
    expect(throttle.check("ninguem@x.com", "1.1.1.1").allowed).toBe(false);
    expect(throttle.check("  NINGUEM@x.com ", "1.1.1.1").allowed).toBe(false);
  });

  it("senha certa zera a contagem; a janela de 15 min recomeça sem acumular falhas antigas", () => {
    const { throttle, advance } = setup();
    fails(throttle, "a@x.com", "1.1.1.1", 4);
    throttle.succeed("a@x.com", "1.1.1.1");
    fails(throttle, "a@x.com", "1.1.1.1", 4);
    expect(throttle.check("a@x.com", "1.1.1.1").allowed).toBe(true);
    advance(16 * MIN);
    fails(throttle, "a@x.com", "1.1.1.1", 4);
    expect(throttle.check("a@x.com", "1.1.1.1").allowed).toBe(true);
  });

  it("memória limitada: milhares de e-mails inventados não crescem o mapa sem fim", () => {
    const { throttle } = setup();
    for (let i = 0; i < 60_000; i++) throttle.fail(`inventado${i}@x.com`, "1.1.1.1");
    // se não houvesse teto, este acesso interno passaria de 60 mil entradas
    const size = (throttle as unknown as { byAccount: Map<string, unknown> }).byAccount.size;
    expect(size).toBeLessThanOrEqual(20_000);
  });
});

// ───────────── Integração: rota de login e cadastro ─────────────
describe("login e cadastro (NG-05, ST-05, B21)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const attempt = (email: string, password: string, ip = "198.51.100.1") =>
    app.inject({ method: "POST", url: "/auth/login", remoteAddress: ip, payload: { email, password } });

  it("bloqueia depois de 5 falhas; durante o bloqueio até a senha CERTA é recusada; Retry-After presente", async () => {
    const { credentials } = await registerStore(app);
    for (let i = 0; i < 5; i++) expect((await attempt(credentials.email, "errada")).statusCode).toBe(401);
    const locked = await attempt(credentials.email, "errada");
    expect(locked.statusCode).toBe(429);
    expect(JSON.parse(locked.body).code).toBe("LOGIN_LOCKED");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    expect((await attempt(credentials.email, credentials.password)).statusCode).toBe(429);
  });

  it("e-mail que NÃO existe é bloqueado do mesmo jeito (sem revelar se a conta existe)", async () => {
    for (let i = 0; i < 5; i++) expect((await attempt("fantasma@teste.com", "qualquer")).statusCode).toBe(401);
    const locked = await attempt("fantasma@teste.com", "qualquer");
    expect(locked.statusCode).toBe(429);
    expect(JSON.parse(locked.body).code).toBe("LOGIN_LOCKED");
  });

  it("o dono em outro IP continua entrando enquanto um atacante está bloqueado", async () => {
    const { credentials } = await registerStore(app);
    for (let i = 0; i < 5; i++) await attempt(credentials.email, "errada", "203.0.113.50");
    expect((await attempt(credentials.email, "errada", "203.0.113.50")).statusCode).toBe(429);
    expect((await attempt(credentials.email, credentials.password, "198.51.100.77")).statusCode).toBe(200);
  });

  it("tempo de resposta de e-mail inexistente ≈ senha errada de conta existente (ST-05)", async () => {
    const { credentials } = await registerStore(app);
    const median = async (email: string) => {
      const times: number[] = [];
      for (let i = 0; i < 4; i++) {
        const t0 = process.hrtime.bigint();
        await attempt(email, "errada", `203.0.113.${100 + i}`);
        times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      return times.sort((a, b) => a - b)[1];
    };
    const known = await median(credentials.email);
    const unknown = await median("fantasma@teste.com");
    // sem o hash falso, "inexistente" voltaria em ~1 ms contra dezenas de ms do bcrypt
    expect(unknown).toBeGreaterThan(known * 0.4);
  });

  it("cadastro com e-mail já usado responde 409 EMAIL_IN_USE (não 500)", async () => {
    await registerStore(app, { email: "dup@teste.com" });
    const second = await registerStore(app, { email: "dup@teste.com" });
    expect(second.response.statusCode).toBe(409);
    expect(JSON.parse(second.response.body).code).toBe("EMAIL_IN_USE");
  });

  it("corrida: dois cadastros ao mesmo tempo com o mesmo e-mail ⇒ um 201 e um 409, nunca 500", async () => {
    const payload = (n: number) => ({ storeName: `Loja ${n}`, slug: `loja-corrida-${n}`, code: `CR${n}`, email: "corrida@teste.com", password: "senha123" });
    const results = await Promise.all([1, 2, 3].map((n) => app.inject({ method: "POST", url: "/auth/register", payload: payload(n) })));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.every((c) => c === 201 || c === 409)).toBe(true);
    expect(await prisma.user.count({ where: { email: "corrida@teste.com" } })).toBe(1);
  });

  it("corrida: mesmo slug com e-mails diferentes ⇒ um 201 e um 409, nunca 500", async () => {
    const payload = (n: number) => ({ storeName: `Loja ${n}`, slug: "mesmo-slug", code: `SL${n}`, email: `dono${n}@teste.com`, password: "senha123" });
    const results = await Promise.all([1, 2, 3].map((n) => app.inject({ method: "POST", url: "/auth/register", payload: payload(n) })));
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.every((c) => c === 201 || c === 409)).toBe(true);
    expect(await prisma.store.count({ where: { slug: "mesmo-slug" } })).toBe(1);
  });
});
