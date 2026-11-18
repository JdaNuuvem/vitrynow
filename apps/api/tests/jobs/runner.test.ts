import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@meucardapio/db";
import { JobRunner, jobsConfigFromEnv } from "../../src/jobs/runner";
import type { Job, JobLogger } from "../../src/jobs/types";

// Unitário: nenhum acesso ao banco (db é um objeto vazio) e nenhum relógio real.

type Entry = { level: "info" | "warn" | "error"; obj: Record<string, unknown>; msg?: string };
function memoryLog() {
  const entries: Entry[] = [];
  const log: JobLogger = {
    info: (obj, msg) => entries.push({ level: "info", obj, msg }),
    warn: (obj, msg) => entries.push({ level: "warn", obj, msg }),
    error: (obj, msg) => entries.push({ level: "error", obj, msg }),
  };
  return { log, entries, messages: () => entries.map((e) => e.msg) };
}

const FAKE_DB = {} as PrismaClient;
let nextKey = 1n;
function job(overrides: Partial<Job> = {}): Job {
  return { name: "teste.um", everyMs: 60_000, lockKey: nextKey++, runOnce: async () => ({ processed: 0 }), ...overrides };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("JobRunner — registro", () => {
  it("recusa nome fora do padrão dominio.acao, nome repetido, lockKey repetido, intervalo curto e limite inválido", () => {
    const { log } = memoryLog();
    const runner = new JobRunner({ db: FAKE_DB, log });
    runner.register(job({ name: "teste.um", lockKey: 10n }));

    expect(() => runner.register(job({ name: "SemPonto", lockKey: 11n }))).toThrow(/nome de job inválido/);
    expect(() => runner.register(job({ name: "teste.um", lockKey: 12n }))).toThrow(/duplicado/);
    expect(() => runner.register(job({ name: "teste.dois", lockKey: 10n }))).toThrow(/lockKey repetido/);
    expect(() => runner.register(job({ name: "teste.tres", lockKey: 13n, everyMs: 999 }))).toThrow(/everyMs/);
    expect(() => runner.register(job({ name: "teste.quatro", lockKey: 14n, limit: 0 }))).toThrow(/limit/);
    expect(() => runner.register(job({ name: "teste.cinco", lockKey: 15n, limit: 1.5 }))).toThrow(/limit/);
    expect(runner.names()).toEqual(["teste.um"]);
  });

  it("run de job desconhecido é erro de programação (rejeita)", async () => {
    const runner = new JobRunner({ db: FAKE_DB, log: memoryLog().log });
    await expect(runner.run("nao.existe")).rejects.toThrow(/desconhecido/);
  });
});

describe("JobRunner — execução", () => {
  it("passa relógio injetado, limite padrão (100) e registra job.start/job.ok com duração e processed", async () => {
    const { log, messages, entries } = memoryLog();
    const fixed = new Date("2026-11-16T12:00:00.000Z");
    const seen: { now?: Date; limit?: number } = {};
    const runner = new JobRunner({ db: FAKE_DB, log, now: () => fixed });
    runner.register(
      job({
        runOnce: async (ctx) => {
          seen.now = ctx.now;
          seen.limit = ctx.limit;
          return { processed: 7 };
        },
      }),
    );

    const result = await runner.run("teste.um");

    expect(result).toMatchObject({ status: "ok", processed: 7, lagMs: null });
    expect(seen.now).toEqual(fixed);
    expect(seen.limit).toBe(100);
    expect(messages()).toEqual(["job.start", "job.ok"]);
    expect(entries[1].obj).toMatchObject({ job: "teste.um", processed: 7 });
    expect(runner.snapshot()[0]).toMatchObject({
      lastStatus: "ok",
      lastProcessed: 7,
      lastRunAt: fixed.toISOString(),
      consecutiveFailures: 0,
      running: false,
    });
  });

  it("usa o limit do job quando informado", async () => {
    const seen: number[] = [];
    const runner = new JobRunner({ db: FAKE_DB, log: memoryLog().log });
    runner.register(job({ limit: 5, runOnce: async (ctx) => (seen.push(ctx.limit), { processed: 0 }) }));
    await runner.run("teste.um");
    expect(seen).toEqual([5]);
  });

  it("falha de um job vira job.fail, não lança, não afeta outro job e zera ao voltar a funcionar", async () => {
    const { log, messages } = memoryLog();
    const runner = new JobRunner({ db: FAKE_DB, log });
    let broken = true;
    runner.register(
      job({
        name: "teste.quebra",
        runOnce: async () => {
          if (broken) throw new Error("falhou de propósito");
          return { processed: 1 };
        },
      }),
    );
    runner.register(job({ name: "teste.saudavel", runOnce: async () => ({ processed: 3 }) }));

    expect(await runner.run("teste.quebra")).toMatchObject({ status: "failed", error: "falhou de propósito" });
    expect(await runner.run("teste.quebra")).toMatchObject({ status: "failed" });
    expect(await runner.run("teste.saudavel")).toMatchObject({ status: "ok", processed: 3 });
    expect(runner.snapshot().find((s) => s.name === "teste.quebra")).toMatchObject({ lastStatus: "failed", consecutiveFailures: 2 });
    expect(messages().filter((m) => m === "job.fail")).toHaveLength(2);

    broken = false;
    expect(await runner.run("teste.quebra")).toMatchObject({ status: "ok" });
    expect(runner.snapshot().find((s) => s.name === "teste.quebra")).toMatchObject({ lastStatus: "ok", consecutiveFailures: 0 });
  });

  it("não inicia o job se a execução anterior ainda não terminou (sobreposição)", async () => {
    const gate = deferred();
    let calls = 0;
    const runner = new JobRunner({ db: FAKE_DB, log: memoryLog().log });
    runner.register(job({ runOnce: async () => (calls++, await gate.promise, { processed: 1 }) }));

    const first = runner.run("teste.um");
    expect(runner.snapshot()[0].running).toBe(true);
    expect(await runner.run("teste.um")).toEqual({ status: "skipped", reason: "overlap" });
    gate.resolve();
    expect(await first).toMatchObject({ status: "ok" });
    expect(calls).toBe(1);
    expect(await runner.run("teste.um")).toMatchObject({ status: "ok" });
    expect(calls).toBe(2);
  });

  it("registra o atraso do job (lagMs) e tolera falha ao medi-lo", async () => {
    const { log, messages } = memoryLog();
    const runner = new JobRunner({ db: FAKE_DB, log });
    runner.register(job({ name: "teste.lag", lagMs: async () => 4200 }));
    runner.register(
      job({
        name: "teste.lagquebrado",
        lagMs: async () => {
          throw new Error("sem acesso");
        },
      }),
    );

    expect(await runner.run("teste.lag")).toMatchObject({ status: "ok", lagMs: 4200 });
    expect(await runner.run("teste.lagquebrado")).toMatchObject({ status: "ok", lagMs: null });
    expect(messages()).toContain("job.lag_unavailable");
  });
});

describe("JobRunner — agenda", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("roda logo após o início (até 5 s), repete a cada intervalo com jitter de ±10 % e para no stop", async () => {
    let runs = 0;
    const randoms = [0, 0, 1, 0.5]; // 1º atraso = 0; próximo = everyMs*(1-10%); depois +10 %; depois exato
    const runner = new JobRunner({ db: FAKE_DB, log: memoryLog().log, random: () => randoms.shift() ?? 0.5 });
    runner.register(job({ everyMs: 10_000, runOnce: async () => (runs++, { processed: 0 }) }));

    runner.start();
    runner.start(); // idempotente
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toBe(1);

    await vi.advanceTimersByTimeAsync(8_998); // jitter -10 % ⇒ 9 000 ms desde t=0 (1 ms já passou)
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toBe(2);

    await vi.advanceTimersByTimeAsync(10_999); // jitter +10 % ⇒ 11 000 ms
    expect(runs).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toBe(3);

    await runner.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toBe(3);
  });

  it("JOBS_ONLY: só agenda os jobs listados", async () => {
    const ran: string[] = [];
    const runner = new JobRunner({ db: FAKE_DB, log: memoryLog().log, random: () => 0, only: ["teste.b"] });
    runner.register(job({ name: "teste.a", runOnce: async () => (ran.push("a"), { processed: 0 }) }));
    runner.register(job({ name: "teste.b", runOnce: async () => (ran.push("b"), { processed: 0 }) }));

    runner.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(ran).toEqual(["b"]);
    await runner.stop();
  });

  it("stop espera o lote corrente terminar e depois recusa novas execuções", async () => {
    const gate = deferred();
    let finished = false;
    const runner = new JobRunner({ db: FAKE_DB, log: memoryLog().log, random: () => 0 });
    runner.register(
      job({
        runOnce: async () => {
          await gate.promise;
          finished = true;
          return { processed: 1 };
        },
      }),
    );
    runner.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(runner.snapshot()[0].running).toBe(true);

    let stopped = false;
    const stopping = runner.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(stopped).toBe(false); // ainda esperando o lote
    gate.resolve();
    await stopping;
    expect(finished).toBe(true);
    expect(await runner.run("teste.um")).toEqual({ status: "skipped", reason: "stopping" });
  });

  it("stop desiste do lote que passar do tempo limite", async () => {
    const runner = new JobRunner({ db: FAKE_DB, log: memoryLog().log, random: () => 0 });
    runner.register(job({ runOnce: () => new Promise(() => undefined) })); // nunca termina
    runner.start();
    await vi.advanceTimersByTimeAsync(1);

    const stopping = runner.stop(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(stopping).resolves.toBeUndefined();
  });
});

describe("jobsConfigFromEnv", () => {
  it("padrão: desligado em teste, ligado nos demais; JOBS_ENABLED explícito vence", () => {
    expect(jobsConfigFromEnv({ NODE_ENV: "test" }).enabled).toBe(false);
    expect(jobsConfigFromEnv({ NODE_ENV: "development" }).enabled).toBe(true);
    expect(jobsConfigFromEnv({ NODE_ENV: "production" }).enabled).toBe(true);
    expect(jobsConfigFromEnv({}).enabled).toBe(true);
    expect(jobsConfigFromEnv({ NODE_ENV: "production", JOBS_ENABLED: "false" }).enabled).toBe(false);
    expect(jobsConfigFromEnv({ NODE_ENV: "test", JOBS_ENABLED: "true" }).enabled).toBe(true);
  });

  it("JOBS_ONLY vira lista sem vazios", () => {
    expect(jobsConfigFromEnv({ JOBS_ONLY: " a.b , c.d ,," }).only).toEqual(["a.b", "c.d"]);
    expect(jobsConfigFromEnv({ JOBS_ONLY: "" }).only).toBeUndefined();
    expect(jobsConfigFromEnv({}).only).toBeUndefined();
  });
});
