import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { JOB_LOCK_KEYS } from "../../src/jobs/lockKeys";
import { createJobRunner, registeredJobs } from "../../src/jobs/registry";
import { makeApp } from "../helpers";

// Contrato dos jobs registrados (ADR-0011 §6). Quem registra um job novo passa por aqui.

describe("registro de jobs — contrato", () => {
  it("todo job tem nome 'dominio.acao' previsto em JOB_LOCK_KEYS, lockKey própria e a mesma do arquivo central", () => {
    const names = registeredJobs.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    const keys = registeredJobs.map((j) => j.lockKey);
    expect(new Set(keys).size).toBe(keys.length);

    for (const job of registeredJobs) {
      expect(job.name).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/);
      expect(Object.keys(JOB_LOCK_KEYS)).toContain(job.name);
      expect(job.lockKey).toBe(JOB_LOCK_KEYS[job.name as keyof typeof JOB_LOCK_KEYS]);
      expect(job.everyMs).toBeGreaterThanOrEqual(1000);
      expect(job.limit === undefined || job.limit >= 1).toBe(true);
      expect(typeof job.runOnce).toBe("function");
    }
  });

  it("as chaves reservadas em JOB_LOCK_KEYS são todas distintas", () => {
    const values = Object.values(JOB_LOCK_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("createJobRunner registra todos os jobs sem erro", () => {
    const runner = createJobRunner({ db: prisma, log: { info() {}, warn() {}, error() {} } });
    expect(runner.names().sort()).toEqual(registeredJobs.map((j) => j.name).sort());
  });
});

describe("plugin de jobs na API", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });
  afterEach(async () => {
    await app.close().catch(() => undefined);
  });

  it("expõe app.jobs e NÃO agenda nada em NODE_ENV=test (JOBS_ENABLED desligado por padrão)", async () => {
    await app.ready();
    expect(app.jobs.names()).toEqual(registeredJobs.map((j) => j.name));
    expect(app.jobs.snapshot().every((s) => s.lastRunAt === null)).toBe(true);
  });

  it("no encerramento, para o runner ANTES de desconectar o Prisma", async () => {
    await app.ready();
    const order: string[] = [];
    vi.spyOn(app.jobs, "stop").mockImplementation(async () => void order.push("jobs.stop"));
    const disconnect = vi.spyOn(prisma, "$disconnect").mockImplementation(async () => void order.push("prisma.disconnect"));

    await app.close();

    expect(order).toEqual(["jobs.stop", "prisma.disconnect"]);
    disconnect.mockRestore();
  });
});
