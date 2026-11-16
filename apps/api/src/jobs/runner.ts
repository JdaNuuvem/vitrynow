import type { PrismaClient } from "@meucardapio/db";
import {
  DEFAULT_JOB_LIMIT,
  MIN_JOB_INTERVAL_MS,
  type Job,
  type JobLogger,
  type JobRunResult,
  type JobStats,
} from "./types";

export type JobRunnerOptions = {
  db: PrismaClient;
  log: JobLogger;
  /** Relógio injetável (padrão: relógio do sistema). */
  now?: () => Date;
  /** Aleatoriedade injetável para o jitter (padrão: Math.random). */
  random?: () => number;
  /** Se informado, só estes jobs rodam (`JOBS_ONLY`, para depuração). */
  only?: string[];
};

const JITTER = 0.1;
const MAX_FIRST_DELAY_MS = 5000;

/** Lê as variáveis de ambiente do ADR-0011 §2: `JOBS_ENABLED` e `JOBS_ONLY`. */
export function jobsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; only?: string[] } {
  const flag = env.JOBS_ENABLED?.trim().toLowerCase();
  // Padrão: ligado, exceto em testes (os testes chamam `run(name)` direto).
  const enabled = flag === "true" ? true : flag === "false" ? false : env.NODE_ENV !== "test";
  const only = env.JOBS_ONLY?.split(",").map((name) => name.trim()).filter(Boolean);
  return { enabled, only: only && only.length > 0 ? only : undefined };
}

/**
 * Executor de jobs dentro do processo da API (ADR-0011). Sem Redis nem cron do SO; o estado
 * dos itens fica no Postgres e cada job é idempotente. O runner cuida de agenda, sobreposição,
 * isolamento de falhas e observabilidade; a exclusão mútua entre instâncias é do job
 * (ver `claimWithLock`).
 */
export class JobRunner {
  private readonly jobs = new Map<string, Job>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Map<string, Promise<JobRunResult>>();
  private readonly stats = new Map<string, JobStats>();
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly only?: Set<string>;
  private started = false;
  private stopping = false;

  constructor(private readonly options: JobRunnerOptions) {
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.only = options.only ? new Set(options.only) : undefined;
  }

  register(job: Job): void {
    if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/.test(job.name)) {
      throw new Error(`nome de job inválido: "${job.name}" (use "dominio.acao")`);
    }
    if (this.jobs.has(job.name)) throw new Error(`job duplicado: ${job.name}`);
    for (const other of this.jobs.values()) {
      if (other.lockKey === job.lockKey) throw new Error(`lockKey repetido entre "${other.name}" e "${job.name}"`);
    }
    if (!Number.isFinite(job.everyMs) || job.everyMs < MIN_JOB_INTERVAL_MS) {
      throw new Error(`job ${job.name}: everyMs deve ser >= ${MIN_JOB_INTERVAL_MS}`);
    }
    if (job.limit !== undefined && (!Number.isInteger(job.limit) || job.limit < 1)) {
      throw new Error(`job ${job.name}: limit deve ser inteiro >= 1`);
    }
    this.jobs.set(job.name, job);
    this.stats.set(job.name, {
      name: job.name,
      everyMs: job.everyMs,
      lastRunAt: null,
      lastStatus: null,
      lastDurationMs: null,
      lastProcessed: null,
      lagMs: null,
      consecutiveFailures: 0,
      running: false,
    });
  }

  names(): string[] {
    return [...this.jobs.keys()];
  }

  snapshot(): JobStats[] {
    return [...this.stats.values()].map((s) => ({ ...s, running: this.inFlight.has(s.name) }));
  }

  /** Executa um job agora. Nunca lança por falha do job: vira `{ status: "failed" }` e log `job.fail`. */
  run(name: string): Promise<JobRunResult> {
    const job = this.jobs.get(name);
    if (!job) return Promise.reject(new Error(`job desconhecido: ${name}`));
    if (this.stopping) return Promise.resolve({ status: "skipped", reason: "stopping" });
    if (this.inFlight.has(name)) return Promise.resolve({ status: "skipped", reason: "overlap" });

    const promise = this.execute(job).finally(() => this.inFlight.delete(name));
    this.inFlight.set(name, promise);
    return promise;
  }

  private async execute(job: Job): Promise<JobRunResult> {
    const { db, log } = this.options;
    const stats = this.stats.get(job.name)!;
    const startedAt = this.now();
    const t0 = process.hrtime.bigint();
    const elapsed = () => Number((process.hrtime.bigint() - t0) / 1_000_000n);
    log.info({ job: job.name }, "job.start");
    try {
      const { processed } = await job.runOnce({ now: startedAt, db, log, limit: job.limit ?? DEFAULT_JOB_LIMIT });
      const durationMs = elapsed();
      let lagMs: number | null = null;
      if (job.lagMs) {
        try {
          lagMs = await job.lagMs({ now: this.now(), db, log });
        } catch (error) {
          log.warn({ job: job.name, error: messageOf(error) }, "job.lag_unavailable");
        }
      }
      Object.assign(stats, {
        lastRunAt: startedAt.toISOString(),
        lastStatus: "ok",
        lastDurationMs: durationMs,
        lastProcessed: processed,
        lagMs,
        consecutiveFailures: 0,
      });
      log.info({ job: job.name, durationMs, processed, lagMs }, "job.ok");
      return { status: "ok", processed, durationMs, lagMs };
    } catch (error) {
      const durationMs = elapsed();
      stats.lastRunAt = startedAt.toISOString();
      stats.lastStatus = "failed";
      stats.lastDurationMs = durationMs;
      stats.consecutiveFailures += 1;
      log.error({ job: job.name, durationMs, error: messageOf(error) }, "job.fail");
      return { status: "failed", error: messageOf(error), durationMs };
    }
  }

  /** Agenda todos os jobs (respeitando `only`). Idempotente. */
  start(): void {
    if (this.started || this.stopping) return;
    this.started = true;
    for (const job of this.jobs.values()) {
      if (this.only && !this.only.has(job.name)) continue;
      // Primeira execução logo (recupera atrasos após downtime), espalhada para não rodar tudo junto.
      this.schedule(job, this.random() * Math.min(job.everyMs, MAX_FIRST_DELAY_MS));
    }
  }

  private schedule(job: Job, delayMs: number): void {
    if (this.stopping) return;
    const timer = setTimeout(() => {
      void this.run(job.name).then(() => this.schedule(job, this.nextDelay(job)));
    }, delayMs);
    timer.unref();
    this.timers.set(job.name, timer);
  }

  private nextDelay(job: Job): number {
    return job.everyMs * (1 + (this.random() * 2 - 1) * JITTER);
  }

  /** Para de agendar e espera o lote corrente (até `timeoutMs`). */
  async stop(timeoutMs = 10_000): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const pending = Promise.allSettled([...this.inFlight.values()]);
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
        timeout.unref();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
