// SEC-34 — faixa de hash de senha (`hashLane`): bcrypt nativo, N em voo, fila de 32, 503 `SERVER_BUSY` (Atlas, Nightingale, Sun Tzu R1–R7).
// Parte 1: a faixa em si (determinística, sem banco). Parte 2: as rotas de verdade com a faixa CHEIA. Parte 3: varredura (nada chama bcrypt fora dela).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import bcryptjs from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as emailLib from "../src/lib/email";
import { LoginThrottle } from "../src/lib/loginThrottle";
import { resetHooks } from "../src/lib/passwordReset";
import { hashToken } from "../src/lib/tokenHash";
import { SERVER_BUSY_RETRY_AFTER_SECONDS, ServerBusyError } from "../src/shared/errors";
import { HASH_LANE_PER_KEY_MAX, HASH_LANE_QUEUE_MAX, HASH_LANE_WAIT_MAX_MS, HashLane, hashLane, laneSize } from "../src/shared/hashLane";
import { DUMMY_HASH, bcryptPasswordHasher } from "../src/shared/passwordHasher";
import { makeApp, registerStore, resetDb } from "./helpers";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
};
const outcome = (promise: Promise<unknown>) => {
  const box: { state: "pendente" | "ok" | "busy" | "erro" } = { state: "pendente" };
  promise.then(
    () => (box.state = "ok"),
    (error: unknown) => (box.state = error instanceof ServerBusyError ? "busy" : "erro"),
  );
  return box;
};
const quiet = () => {};

describe("SEC-34 — a faixa (unidade)", () => {
  it("no máximo N hashes em voo, os outros esperam na ordem de chegada e todos terminam", async () => {
    const lane = new HashLane({ inFlight: 2, maxQueue: 8, maxWaitMs: 5000, maxPerKey: 99 }, quiet);
    const g = gate();
    const started: number[] = [];
    let concurrent = 0;
    let peak = 0;
    const run = (i: number) =>
      lane.run(`origem-${i}`, async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        started.push(i);
        await g.promise;
        concurrent -= 1;
      });
    const all = [0, 1, 2, 3, 4].map(run);
    await tick();
    expect([lane.active, lane.waiting, started]).toEqual([2, 3, [0, 1]]);
    g.open();
    await Promise.all(all);
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect([lane.active, lane.waiting]).toEqual([0, 0]);
  });

  it("TETO da fila é 32 EXATO: o 35º pedido (2 em voo + 32 na fila + 1) é recusado NA HORA e a tarefa dele nunca roda (503 não gasta CPU)", async () => {
    const lane = new HashLane({ inFlight: 2, maxQueue: HASH_LANE_QUEUE_MAX, maxWaitMs: 5000, maxPerKey: 999 }, quiet);
    const g = gate();
    const admitted = Array.from({ length: 2 + HASH_LANE_QUEUE_MAX }, (_, i) => lane.run(`o${i}`, () => g.promise));
    await tick();
    expect([lane.active, lane.waiting]).toEqual([2, HASH_LANE_QUEUE_MAX]);
    const refusedTask = vi.fn(async () => undefined);
    const refused = [lane.run("extra-1", refusedTask), lane.run("extra-2", refusedTask)];
    await expect(refused[0]).rejects.toBeInstanceOf(ServerBusyError);
    await expect(refused[1]).rejects.toBeInstanceOf(ServerBusyError);
    expect(refusedTask).not.toHaveBeenCalled();
    expect(lane.stats.rejectedFull).toBe(2);
    g.open();
    await Promise.all(admitted);
    expect([lane.active, lane.waiting]).toEqual([0, 0]);
  });

  it("ESPERA MÁXIMA: quem não ganha vaga a tempo recebe 503 e a fila/o teto da origem voltam ao normal", async () => {
    const lane = new HashLane({ inFlight: 1, maxQueue: 4, maxWaitMs: 40, maxPerKey: 1 }, quiet);
    const g = gate();
    const holder = lane.run("dono-da-vaga", () => g.promise);
    const t0 = Date.now();
    await expect(lane.run("esperando", async () => undefined)).rejects.toBeInstanceOf(ServerBusyError);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    expect(lane.waiting).toBe(0);
    expect(lane.stats.rejectedWait).toBe(1);
    // o teto da origem foi devolvido junto com a espera: a MESMA origem volta a poder entrar na fila
    const again = outcome(lane.run("esperando", async () => "ok"));
    await tick();
    expect(lane.waiting).toBe(1);
    g.open();
    await holder;
    await sleep(10);
    expect(again.state).toBe("ok");
    expect([lane.active, lane.waiting]).toEqual([0, 0]);
  });

  it("JUSTIÇA (R3): uma origem que dispara 40 pedidos ocupa no máximo 2 vagas (em voo + fila); os outros 38 levam 503 e OUTRA origem é atendida", async () => {
    const lane = new HashLane({ inFlight: 2, maxQueue: HASH_LANE_QUEUE_MAX, maxWaitMs: 5000, maxPerKey: HASH_LANE_PER_KEY_MAX }, quiet);
    expect(HASH_LANE_PER_KEY_MAX).toBe(2);
    const g = gate();
    const task = vi.fn(() => g.promise);
    const fromA = Array.from({ length: 40 }, () => outcome(lane.run("10.0.0.1", task)));
    await tick();
    expect(fromA.filter((o) => o.state === "busy")).toHaveLength(38);
    expect(task).toHaveBeenCalledTimes(2);
    expect(lane.stats.rejectedKey).toBe(38);
    const fromB = outcome(lane.run("10.0.0.2", async () => "atendido"));
    await tick();
    expect(fromB.state).toBe("pendente"); // entrou na fila (a faixa está com as 2 vagas da origem A), NÃO foi recusada
    expect(lane.waiting).toBe(1);
    g.open();
    await sleep(20);
    expect(fromB.state).toBe("ok");
    expect(fromA.filter((o) => o.state === "ok")).toHaveLength(2);
    expect([lane.active, lane.waiting]).toEqual([0, 0]);
  });

  it("a VAGA volta em `finally`: tarefa que lança (de forma assíncrona ou síncrona) não prende a faixa nem o teto da origem, e o erro é o da tarefa (não um 503)", async () => {
    const lane = new HashLane({ inFlight: 1, maxQueue: 4, maxWaitMs: 5000, maxPerKey: 1 }, quiet);
    await expect(lane.run("a", async () => Promise.reject(new Error("falha-assincrona")))).rejects.toThrow("falha-assincrona");
    expect([lane.active, lane.waiting]).toEqual([0, 0]);
    await expect(
      lane.run("a", () => {
        throw new Error("falha-sincrona");
      }),
    ).rejects.toThrow("falha-sincrona");
    expect([lane.active, lane.waiting]).toEqual([0, 0]);
    expect(await lane.run("a", async () => "a mesma origem volta a passar")).toBe("a mesma origem volta a passar");
    // com fila: a tarefa que falha libera a vaga para a próxima da fila
    const g = gate();
    const first = lane.run("b", async () => {
      await g.promise;
      throw new Error("falha-com-fila");
    });
    const second = outcome(lane.run("c", async () => "segunda"));
    first.catch(quiet);
    await tick();
    expect(lane.waiting).toBe(1);
    g.open();
    await sleep(20);
    expect(second.state).toBe("ok");
    expect([lane.active, lane.waiting]).toEqual([0, 0]);
  });

  it("as TRÊS recusas (fila cheia, teto da origem, espera esgotada) são o MESMO erro: status, código e mensagem fixos (503 não é oráculo)", async () => {
    const lane = new HashLane({ inFlight: 1, maxQueue: 1, maxWaitMs: 30, maxPerKey: 1 }, quiet);
    const g = gate();
    const holder = lane.run("x", () => g.promise);
    const waiter = lane.run("y", async () => undefined); // ocupa a fila; vai estourar a espera
    const errors: ServerBusyError[] = [];
    for (const p of [lane.run("z", async () => undefined), lane.run("x", async () => undefined), waiter]) errors.push((await p.then(() => null, (e) => e)) as ServerBusyError);
    expect(errors.every((e) => e instanceof ServerBusyError)).toBe(true);
    const shape = errors.map((e) => JSON.stringify({ statusCode: e.statusCode, code: e.code, message: e.message, extra: e.extra ?? null }));
    expect(new Set(shape).size).toBe(1);
    expect(JSON.parse(shape[0])).toMatchObject({ statusCode: 503, code: "SERVER_BUSY" });
    expect([lane.stats.rejectedFull, lane.stats.rejectedKey, lane.stats.rejectedWait]).toEqual([1, 1, 1]);
    g.open();
    await holder;
  });

  it("tamanho da faixa = metade do threadpool, no máximo núcleos − 1, no mínimo 1", () => {
    expect(laneSize(4, 12)).toBe(2);
    expect(laneSize(4, 2)).toBe(1); // VPS de 2 vCPU
    expect(laneSize(4, 1)).toBe(1); // nunca zero
    expect(laneSize(8, 12)).toBe(4);
    expect(laneSize(1, 12)).toBe(1);
    expect(laneSize(8, 3)).toBe(2);
    expect([HASH_LANE_QUEUE_MAX, HASH_LANE_WAIT_MAX_MS]).toEqual([32, 2000]);
  });

  it("alerta de fila cheia: no máximo UMA linha por minuto, só contagens (nada de origem, e-mail ou senha)", async () => {
    const warn = vi.fn();
    const lane = new HashLane({ inFlight: 1, maxQueue: 1, maxWaitMs: 5000, maxPerKey: 1 }, warn);
    const g = gate();
    const holder = lane.run("origem-secreta-xyz", () => g.promise);
    for (let i = 0; i < 10; i += 1) await lane.run("origem-secreta-xyz", async () => undefined).catch(quiet);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("SERVER_BUSY");
    expect(String(warn.mock.calls[0][0])).not.toContain("secreta");
    g.open();
    await holder;
  });
});

// ───────────── as rotas, com a faixa cheia ─────────────
describe("SEC-34 — as rotas com a faixa cheia (R1–R7)", () => {
  let app: ReturnType<typeof makeApp>;
  const openers: Array<() => void> = [];
  const pending: Promise<unknown>[] = [];
  const originalWait = hashLane.options.maxWaitMs;
  let seq = 0;
  const ip = () => `10.77.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`;
  const json = (r: { body: string }) => JSON.parse(r.body);

  // Enche a faixa: `inFlight` em voo + `maxQueue` na fila, cada um de uma origem diferente (nenhuma é a do teste).
  function fillLane(onlyRunning = false) {
    const g = gate();
    openers.push(g.open);
    const total = hashLane.options.inFlight + (onlyRunning ? 0 : hashLane.options.maxQueue);
    for (let i = 0; i < total; i += 1) pending.push(hashLane.run(`ocupante-${openers.length}-${i}`, () => g.promise).catch(quiet));
  }
  async function releaseLane() {
    while (openers.length) openers.pop()!();
    await Promise.all(pending.splice(0));
    await tick();
  }

  beforeEach(async () => {
    (hashLane.options as { maxWaitMs: number }).maxWaitMs = 60_000; // os ocupantes não podem expirar no meio do teste
    await resetDb();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await releaseLane();
    (hashLane.options as { maxWaitMs: number }).maxWaitMs = originalWait;
    expect([hashLane.active, hashLane.waiting]).toEqual([0, 0]); // nenhuma vaga ficou presa por teste nenhum
    vi.restoreAllMocks();
    await app.close();
    await resetDb();
  });

  const post = (url: string, payload: Record<string, unknown>, remoteAddress = ip(), headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url, remoteAddress, headers, payload: payload as never });
  const busyBody = { error: "Servidor ocupado. Tente de novo em instantes.", code: "SERVER_BUSY" };

  async function accountWithToken(email: string) {
    const urls: string[] = [];
    const spy = vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async ({ resetUrl }) => {
      urls.push(resetUrl);
    });
    const { credentials } = await registerStore(app, { email });
    await post("/auth/forgot-password", { email: credentials.email });
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    spy.mockRestore();
    return { credentials, token: new URLSearchParams(new URL(urls[0]).hash.slice(1)).get("token")! };
  }
  const tokenRow = (token: string) => prisma.passwordResetToken.findFirstOrThrow({ where: { tokenHash: hashToken(token) } });

  it("R4: login de conta EXISTENTE e de conta INEXISTENTE com a faixa cheia ⇒ o MESMO 503 (corpo, Retry-After fixo e tamanho iguais)", async () => {
    const { credentials } = await registerStore(app);
    fillLane();
    const existing = await post("/auth/login", { email: credentials.email, password: "senha-errada-1" });
    const missing = await post("/auth/login", { email: "ninguem@exemplo.com", password: "senha-errada-1" });
    for (const r of [existing, missing]) {
      expect(r.statusCode).toBe(503);
      expect(json(r)).toEqual(busyBody);
      expect(r.headers["retry-after"]).toBe(String(SERVER_BUSY_RETRY_AFTER_SECONDS));
    }
    expect(existing.body).toBe(missing.body);
    expect(existing.headers["content-length"]).toBe(missing.headers["content-length"]);
    // com a faixa livre, as duas contas respondem a mesma coisa de sempre (senha errada = 401 igual) e AMBAS passam pela faixa (o DUMMY_HASH incluído)
    await releaseLane();
    const before = hashLane.stats.ran;
    const a = await post("/auth/login", { email: credentials.email, password: "senha-errada-1" });
    const b = await post("/auth/login", { email: "ninguem@exemplo.com", password: "senha-errada-1" });
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
    expect(a.body).toBe(b.body);
    expect(hashLane.stats.ran - before).toBe(2);
  });

  it("R5: o 503 devolve a tentativa reservada: 2 recusas da faixa NÃO gastam as 5 tentativas do par (conta, IP); depois dos 5 palpites reais o 6º é 429 LOGIN_LOCKED", async () => {
    const { credentials } = await registerStore(app);
    const origin = "10.20.30.40";
    const attempt = (password: string) => post("/auth/login", { email: credentials.email, password }, origin);
    fillLane();
    expect([(await attempt("palpite-0000")).statusCode, (await attempt("palpite-0001")).statusCode]).toEqual([503, 503]);
    await releaseLane();
    const wrong: number[] = [];
    for (let i = 0; i < 5; i += 1) wrong.push((await attempt(`errada-${i}`)).statusCode);
    expect(wrong).toEqual([401, 401, 401, 401, 401]); // sem a devolução, o 4º já seria 429
    const sixth = await attempt("errada-5");
    expect([sixth.statusCode, json(sixth).code]).toEqual([429, "LOGIN_LOCKED"]); // o 503 também não zerou as tentativas gastas
    // a regra mora no LoginThrottle: reserve + refund volta ao zero
    const throttle = new LoginThrottle();
    for (let i = 0; i < 5; i += 1) {
      expect(throttle.reserve("a@b.com", "1.1.1.1").allowed).toBe(true);
      throttle.refund("a@b.com", "1.1.1.1");
    }
    for (let i = 0; i < 5; i += 1) expect(throttle.reserve("a@b.com", "1.1.1.1").allowed).toBe(true);
    expect(throttle.reserve("a@b.com", "1.1.1.1").allowed).toBe(false);
  });

  it("R7: cadastro com a faixa cheia ⇒ 503 SEM loja nem usuário pela metade; liberada a faixa, o MESMO corpo cadastra", async () => {
    const body = { storeName: "Loja da Faixa", slug: "loja-da-faixa", code: "LFX1", email: "faixa@exemplo.com", password: "senha-da-faixa-1" };
    fillLane();
    const r = await post("/auth/register", body);
    expect([r.statusCode, json(r), r.headers["retry-after"]]).toEqual([503, busyBody, "2"]);
    expect([await prisma.store.count(), await prisma.user.count()]).toEqual([0, 0]);
    await releaseLane();
    expect((await post("/auth/register", body)).statusCode).toBe(201);
    expect([await prisma.store.count(), await prisma.user.count()]).toEqual([1, 1]);
  });

  it("R1: redefinição com a faixa cheia + token VIVO + e-mail CERTO ⇒ 503 e o token fica INTACTO (usedAt, emailFailures, expiresAt); o MESMO link funciona depois", async () => {
    const a = await accountWithToken("r1@exemplo.com");
    const before = await tokenRow(a.token);
    fillLane();
    const r = await post("/auth/reset-password", { token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
    expect([r.statusCode, json(r), r.headers["retry-after"]]).toEqual([503, busyBody, "2"]);
    const after = await tokenRow(a.token);
    expect([after.usedAt, after.emailFailures, after.expiresAt]).toEqual([null, before.emailFailures, before.expiresAt]);
    // a senha NÃO mudou
    await releaseLane();
    expect((await post("/auth/login", { email: a.credentials.email, password: a.credentials.password })).statusCode).toBe(200);
    // as RECUSAS seguem recusas normais com a faixa cheia (não pagam bcrypt, não viram 503) e contam a falha como sempre
    fillLane();
    const wrongEmail = await post("/auth/reset-password", { token: a.token, email: "outro@exemplo.com", newPassword: "senha-nova-do-dono" });
    expect([wrongEmail.statusCode, json(wrongEmail)]).toEqual([400, { error: "token inválido ou expirado" }]);
    const mid = await tokenRow(a.token);
    expect([mid.usedAt, mid.emailFailures]).toEqual([null, 1]);
    await releaseLane();
    // o mesmo token ainda redefine
    const ok = await post("/auth/reset-password", { token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
    expect(ok.statusCode).toBe(200);
    expect((await tokenRow(a.token)).usedAt).not.toBeNull();
    expect((await post("/auth/login", { email: a.credentials.email, password: "senha-nova-do-dono" })).statusCode).toBe(200);
  });

  it("defensivo: a leitura achou o token morto (sem hash pronto) mas o banco o dá como vivo no claim ⇒ o claim é DESFEITO (token intacto, 400 genérico) e o link ainda funciona", async () => {
    const a = await accountWithToken("defensivo@exemplo.com");
    const original = (await tokenRow(a.token)).expiresAt;
    await prisma.passwordResetToken.updateMany({ where: { tokenHash: hashToken(a.token) }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    // entre a leitura (token morto: nenhum hash é calculado) e o claim, o vencimento volta ao futuro: o banco passa a dar o token
    resetHooks.beforeClaim = async () => {
      await prisma.passwordResetToken.updateMany({ where: { tokenHash: hashToken(a.token) }, data: { expiresAt: original } });
    };
    try {
      const r = await post("/auth/reset-password", { token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
      expect([r.statusCode, json(r)]).toEqual([400, { error: "token inválido ou expirado" }]);
    } finally {
      resetHooks.beforeClaim = undefined;
    }
    const row = await tokenRow(a.token);
    expect([row.usedAt, row.emailFailures]).toEqual([null, 0]); // nada de token queimado sem senha nova
    expect((await post("/auth/reset-password", { token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" })).statusCode).toBe(200);
  });

  it("R2: a redefinição que ESPERA a faixa não segura transação nem trava (nenhuma conexão `idle in transaction`) e termina quando a vaga abre", async () => {
    const a = await accountWithToken("r2@exemplo.com");
    fillLane(true); // só as vagas em voo: a fila tem espaço, então o pedido ESPERA em vez de ser recusado
    const waiting = post("/auth/reset-password", { token: a.token, email: a.credentials.email, newPassword: "senha-nova-do-dono" });
    await sleep(400);
    expect(hashLane.waiting).toBe(1);
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`;
    expect(Number(rows[0].n)).toBe(0); // o claim (UPDATE do token) só roda DEPOIS do hash, numa transação curta
    const row = await tokenRow(a.token);
    expect(row.usedAt).toBeNull(); // enquanto espera, o token nem foi tocado
    await releaseLane();
    expect((await waiting).statusCode).toBe(200);
    expect((await tokenRow(a.token)).usedAt).not.toBeNull();
  });

  it("R7 (equipe): convite e troca de senha com a faixa cheia ⇒ 503 sem criar usuário nem mudar o hash; liberada, funcionam", async () => {
    const { credentials, cookie } = await registerStore(app);
    const headers = { cookie: cookie! };
    const invite = () => app.inject({ method: "POST", url: "/api/users", remoteAddress: ip(), headers, payload: { email: "equipe@exemplo.com", password: "provisoria-12" } });
    const change = () => app.inject({ method: "POST", url: "/auth/change-password", remoteAddress: ip(), headers, payload: { currentPassword: credentials.password, newPassword: "senha-trocada-12" } });
    const hashBefore = (await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } })).passwordHash;
    fillLane();
    for (const r of [await invite(), await change()]) {
      expect([r.statusCode, json(r), r.headers["retry-after"]]).toEqual([503, busyBody, "2"]);
    }
    expect(await prisma.user.count({ where: { email: "equipe@exemplo.com" } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } })).passwordHash).toBe(hashBefore);
    await releaseLane();
    expect((await invite()).statusCode).toBe(201);
    expect((await change()).statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } })).passwordHash).not.toBe(hashBefore);
  });

  it("R3 (rotas): uma origem com as 2 vagas ocupadas leva 503 na hora; o login de OUTRA origem é atendido", async () => {
    const { credentials } = await registerStore(app);
    const origemA = "10.50.0.1";
    const origemB = "10.50.0.2";
    const g = gate();
    for (let i = 0; i < HASH_LANE_PER_KEY_MAX; i += 1) pending.push(hashLane.run(origemA, () => g.promise).catch(quiet));
    openers.push(g.open);
    await tick();
    const fromA = await post("/auth/login", { email: credentials.email, password: credentials.password }, origemA);
    expect([fromA.statusCode, json(fromA)]).toEqual([503, busyBody]);
    const fromB = post("/auth/login", { email: credentials.email, password: credentials.password }, origemB);
    await releaseLane();
    expect((await fromB).statusCode).toBe(200);
  });

  it("compatibilidade: hash `$2a$` do bcryptjs verifica na faixa, o `$2b$` novo verifica no bcryptjs, e quem tem senha antiga entra", async () => {
    const legacy = await bcryptjs.hash("senha-antiga-123", 10);
    expect(legacy.startsWith("$2a$10$")).toBe(true);
    expect(await bcryptPasswordHasher.verify("senha-antiga-123", legacy, "t")).toBe(true);
    expect(await bcryptPasswordHasher.verify("outra-senha-123", legacy, "t")).toBe(false);
    const fresh = await bcryptPasswordHasher.hash("senha-nova-1234", "t");
    expect(fresh.startsWith("$2b$10$")).toBe(true);
    expect(await bcryptjs.compare("senha-nova-1234", fresh)).toBe(true);
    expect(await bcryptPasswordHasher.verify("x", "isto-nao-e-um-hash", "t")).toBe(false); // hash malformado: false, sem lançar
    expect(await bcryptPasswordHasher.verify("x", DUMMY_HASH, "t")).toBe(false);
    expect(DUMMY_HASH.startsWith("$2b$10$")).toBe(true); // o falso tem o MESMO custo (10) dos reais
    // ponta a ponta: conta gravada com hash antigo
    const { credentials } = await registerStore(app);
    await prisma.user.update({ where: { email: credentials.email }, data: { passwordHash: legacy } });
    const ok = await post("/auth/login", { email: credentials.email, password: "senha-antiga-123" });
    expect(ok.statusCode).toBe(200);
  });
});

// ───────────── varredura ─────────────
describe("SEC-34 — varredura: ninguém chama bcrypt fora da faixa", () => {
  const srcDir = path.resolve(__dirname, "..", "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : full.endsWith(".ts") ? [full] : [];
    });
  const rel = (file: string) => path.relative(srcDir, file).split(path.sep).join("/");

  it("só `shared/passwordHasher.ts` importa `bcrypt`; `bcryptjs` não aparece em `src`; e lá dentro cada hash/compare está DENTRO de `hashLane.run`", () => {
    const importsBcrypt = /(from\s+["']bcrypt(js)?["']|require\(\s*["']bcrypt(js)?["']\s*\)|import\(\s*["']bcrypt(js)?["']\s*\))/;
    const offenders = files(srcDir)
      .filter((f) => rel(f) !== "shared/passwordHasher.ts" && rel(f) !== "bcrypt.d.ts")
      .filter((f) => importsBcrypt.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
    for (const f of files(srcDir)) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/["']bcryptjs["']/);
    const hasher = readFileSync(path.join(srcDir, "shared", "passwordHasher.ts"), "utf8").split("\n");
    const calls = hasher.filter((line) => /bcrypt\.(hash|compare)\(/.test(line) && !/^\s*\/\//.test(line));
    expect(calls.length).toBe(2);
    for (const line of calls) expect(line, line).toMatch(/hashLane\.run\(/);
    // `hashSync` só para o DUMMY_HASH, uma vez, na subida
    expect(hasher.filter((line) => /bcrypt\.hashSync\(/.test(line) && !/^\s*\/\//.test(line))).toHaveLength(1);
  });

  it("nenhuma rota chama o hasher sem a chave da origem e o `DUMMY_HASH` só é comparado pelo hasher (mesma faixa)", () => {
    const auth = readFileSync(path.join(srcDir, "routes", "auth.ts"), "utf8");
    expect(auth).not.toMatch(/bcrypt\./);
    expect(auth).toMatch(/passwordHasher\.verify\(password, user\?\.passwordHash \?\? DUMMY_HASH, clientKey\(clientIpOf\(request\)\)\)/); // SEC-24: o IP vem de clientIpOf (visitante repassado pelo servico interno), nunca de request.ip
    for (const m of auth.matchAll(/passwordHasher\.(hash|verify)\(([^)]*\)?[^)]*)\)/g)) expect(m[0], m[0]).toContain("clientKey(clientIpOf(request))");
  });
});
