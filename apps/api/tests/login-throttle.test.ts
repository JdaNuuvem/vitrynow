import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as emailLib from "../src/lib/email";
import { LoginThrottle, type ThrottleLimits } from "../src/lib/loginThrottle";
import { makeApp, registerStore, resetDb } from "./helpers";

// ───────────── Unitário: reserva atômica e limites (relógio falso, sem banco) ─────────────
describe("LoginThrottle (NG-05 / SEC-20, ST-03, ST-32, ST-33)", () => {
  const MIN = 60_000;
  const LIMITS: ThrottleLimits = { pairAttempts: 5, accountThreshold: 12, delayStepMs: 250, delayMaxMs: 5000 };
  function setup(limits = LIMITS) {
    let t = 1_000_000;
    const throttle = new LoginThrottle(limits, () => t);
    return { throttle, advance: (ms: number) => void (t += ms) };
  }
  const allowed = (r: ReturnType<LoginThrottle["reserve"]>) => r.allowed;

  it("ST-32: rajada de 60 reservas do mesmo par (conta, IP) na mesma passada ⇒ só 5 chegam a testar a senha", () => {
    const { throttle } = setup();
    const results = Array.from({ length: 60 }, () => throttle.reserve("alvo@x.com", "1.1.1.1"));
    expect(results.filter(allowed)).toHaveLength(5);
    const denied = results.find((r) => !r.allowed);
    expect(denied && !denied.allowed && denied.retryAfterSeconds).toBe(60);
  });

  it("o bloqueio do par some sozinho, dobra a cada estouro e tem teto de 15 min", () => {
    const { throttle, advance } = setup();
    const waits: number[] = [];
    for (let round = 0; round < 7; round++) {
      for (let i = 0; i < 5; i++) throttle.reserve("a@x.com", "1.1.1.1");
      const d = throttle.reserve("a@x.com", "1.1.1.1");
      expect(d.allowed).toBe(false);
      if (!d.allowed) {
        waits.push(d.retryAfterSeconds);
        advance(d.retryAfterSeconds * 1000 + 1);
      }
    }
    expect(waits).toEqual([60, 120, 240, 480, 900, 900, 900]);
  });

  it("ST-33: não existe bloqueio duro por conta — 200 tentativas de IPs distintos nunca são negadas, só atrasadas", () => {
    const { throttle } = setup();
    const results = Array.from({ length: 200 }, (_, i) => throttle.reserve("dono@x.com", `10.0.${Math.floor(i / 250)}.${i % 250}`));
    expect(results.every(allowed)).toBe(true);
  });

  it("ST-33: acima do limiar da conta o atraso cresce até o teto e o dono é avisado UMA vez por janela", () => {
    const { throttle, advance } = setup();
    const delays: number[] = [];
    let alerts = 0;
    for (let i = 0; i < 40; i++) {
      const r = throttle.reserve("dono@x.com", `10.1.0.${i}`);
      if (r.allowed) {
        delays.push(r.delayMs);
        if (r.alertOwner) alerts += 1;
      }
    }
    expect(delays.slice(0, 12).every((d) => d === 0)).toBe(true); // até o limiar, sem atraso
    expect(delays[12]).toBe(250); // 13ª tentativa
    expect(delays[13]).toBe(500);
    expect(Math.max(...delays)).toBe(5000); // teto
    expect(alerts).toBe(1);
    advance(16 * MIN); // janela seguinte: pode avisar de novo, e o atraso zera
    let again = 0;
    for (let i = 0; i < 20; i++) {
      const r = throttle.reserve("dono@x.com", `10.2.0.${i}`);
      if (r.allowed && r.alertOwner) again += 1;
    }
    expect(again).toBe(1);
  });

  it("ST-33: o dono em um IP que não errou continua entrando enquanto a conta é atacada de outros IPs", () => {
    const { throttle } = setup();
    for (let i = 0; i < 30; i++) throttle.reserve("dono@x.com", `10.3.0.${i}`);
    const owner = throttle.reserve("dono@x.com", "200.200.200.200");
    expect(owner.allowed).toBe(true); // atrasado, nunca recusado
  });

  it("senha certa devolve a reserva e zera o par; o par bloqueado não é desbloqueado por ela", () => {
    const { throttle } = setup();
    for (let i = 0; i < 4; i++) throttle.reserve("a@x.com", "1.1.1.1");
    throttle.succeed("a@x.com", "1.1.1.1");
    for (let i = 0; i < 4; i++) expect(throttle.reserve("a@x.com", "1.1.1.1").allowed).toBe(true);
  });

  it("e-mail inexistente é tratado igual (não revela a conta) e maiúsculas/espaços não contornam", () => {
    const { throttle } = setup();
    for (let i = 0; i < 5; i++) throttle.reserve("Ninguem@X.com", "1.1.1.1");
    expect(throttle.reserve("ninguem@x.com", "1.1.1.1").allowed).toBe(false);
    expect(throttle.reserve("  NINGUEM@x.com ", "1.1.1.1").allowed).toBe(false);
  });

  it("a janela de 15 min recomeça sem acumular tentativas antigas", () => {
    const { throttle, advance } = setup();
    for (let i = 0; i < 4; i++) throttle.reserve("a@x.com", "1.1.1.1");
    advance(16 * MIN);
    for (let i = 0; i < 4; i++) expect(throttle.reserve("a@x.com", "1.1.1.1").allowed).toBe(true);
  });

  it("memória limitada: milhares de e-mails inventados não crescem os mapas sem fim", () => {
    const { throttle } = setup();
    for (let i = 0; i < 60_000; i++) throttle.reserve(`inventado${i}@x.com`, "1.1.1.1");
    const internals = throttle as unknown as { pairs: Map<string, unknown>; accounts: Map<string, unknown> };
    expect(internals.pairs.size).toBeLessThanOrEqual(20_000);
    expect(internals.accounts.size).toBeLessThanOrEqual(20_000);
  });
});

// ───────────── Integração: rota de login e cadastro ─────────────
describe("login e cadastro (NG-05 / SEC-20, ST-05, ST-33, ST-34, B21)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const attempt = (email: string, password: string, ip = "198.51.100.1") =>
    app.inject({ method: "POST", url: "/auth/login", remoteAddress: ip, payload: { email, password } });

  it("bloqueia o par depois de 5 falhas; durante o bloqueio até a senha CERTA é recusada; Retry-After presente", async () => {
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

  it("ST-33: atacante em vários IPs não tranca o dono; ele entra de um IP novo e é avisado por e-mail uma vez", async () => {
    const alert = vi.spyOn(emailLib, "sendLoginAlertEmail").mockResolvedValue(undefined);
    const { credentials } = await registerStore(app);
    // 14 IPs diferentes, 1 erro cada: passa do limiar de 12 da conta, mas nenhum par estoura
    const wrong = await Promise.all(Array.from({ length: 14 }, (_, i) => attempt(credentials.email, "errada", `203.0.113.${10 + i}`)));
    expect(wrong.every((r) => r.statusCode === 401)).toBe(true); // nenhum 429: sem bloqueio duro por conta
    const owner = await attempt(credentials.email, credentials.password, "198.51.100.200");
    expect(owner.statusCode).toBe(200);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith({ to: credentials.email });
  });

  it("ST-33: o aviso só vai para conta que existe (e-mail inventado não gera e-mail)", async () => {
    const alert = vi.spyOn(emailLib, "sendLoginAlertEmail").mockResolvedValue(undefined);
    await Promise.all(Array.from({ length: 14 }, (_, i) => attempt("fantasma@teste.com", "errada", `203.0.113.${10 + i}`)));
    expect(alert).not.toHaveBeenCalled();
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
    expect(unknown).toBeGreaterThan(known * 0.4);
  });

  it("cadastro com e-mail já usado responde 409 EMAIL_IN_USE (não 500)", async () => {
    await registerStore(app, { email: "dup@teste.com" });
    const second = await registerStore(app, { email: "dup@teste.com" });
    expect(second.response.statusCode).toBe(409);
    expect(JSON.parse(second.response.body).code).toBe("EMAIL_IN_USE");
  });

  it("ST-34: 'VITIMA@x' não cria segunda conta ao lado de 'vitima@x' (caixa e espaços normalizados)", async () => {
    await registerStore(app, { email: "vitima@teste.com" });
    const clone = await registerStore(app, { email: "  VITIMA@Teste.COM " });
    expect(clone.response.statusCode).toBe(409);
    expect(JSON.parse(clone.response.body).code).toBe("EMAIL_IN_USE");
    expect(await prisma.user.count()).toBe(1);
  });

  it("ST-34: o e-mail é gravado em minúsculas e o login funciona digitado de qualquer jeito", async () => {
    const { credentials } = await registerStore(app, { email: "Dono.Misto@Teste.com" });
    const stored = await prisma.user.findFirstOrThrow();
    expect(stored.email).toBe("dono.misto@teste.com");
    expect((await attempt("  DONO.MISTO@TESTE.COM ", credentials.password, "198.51.100.9")).statusCode).toBe(200);
  });

  it("ST-34: o índice único em lower(email) barra e-mail de outra caixa mesmo inserido direto no banco", async () => {
    const { response } = await registerStore(app, { email: "unico@teste.com" });
    expect(response.statusCode).toBe(201);
    const user = await prisma.user.findFirstOrThrow();
    await expect(
      prisma.user.create({ data: { storeId: user.storeId, email: "UNICO@teste.com", passwordHash: "x", role: "STAFF" } }),
    ).rejects.toThrow();
  });

  it("corrida: dois cadastros ao mesmo tempo com o mesmo e-mail ⇒ um 201 e o resto 409, nunca 500", async () => {
    const payload = (n: number) => ({ storeName: `Loja ${n}`, slug: `loja-corrida-${n}`, code: `CR${n}`, email: n === 2 ? "CORRIDA@teste.com" : "corrida@teste.com", password: "senha12345" });
    const results = await Promise.all([1, 2, 3].map((n) => app.inject({ method: "POST", url: "/auth/register", remoteAddress: `10.88.0.${n}`, payload: payload(n) }))); // clientes DISTINTOS: a faixa de hash (SEC-34) limita a 2 vagas por origem
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.every((c) => c === 201 || c === 409)).toBe(true);
    expect(await prisma.user.count()).toBe(1);
  });

  it("corrida: mesmo slug com e-mails diferentes ⇒ um 201 e o resto 409, nunca 500", async () => {
    const payload = (n: number) => ({ storeName: `Loja ${n}`, slug: "mesmo-slug", code: `SL${n}`, email: `dono${n}@teste.com`, password: "senha12345" });
    const results = await Promise.all([1, 2, 3].map((n) => app.inject({ method: "POST", url: "/auth/register", remoteAddress: `10.88.0.${n}`, payload: payload(n) }))); // clientes DISTINTOS: a faixa de hash (SEC-34) limita a 2 vagas por origem
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.every((c) => c === 201 || c === 409)).toBe(true);
    expect(await prisma.store.count({ where: { slug: "mesmo-slug" } })).toBe(1);
  });
});
