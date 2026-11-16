import type { PrismaClient } from "@meucardapio/db";

// Contrato de um job (ADR-0011 §2). Cada job é "gatilho por nível": encontra TODO o trabalho
// vencido e o processa, de forma idempotente. Tick perdido, reinício ou atraso se recuperam sozinhos.

export interface JobLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export type JobContext = {
  /** Relógio do runner (nos testes, um relógio falso). Nada de `new Date()` solto dentro do job. */
  now: Date;
  db: PrismaClient;
  log: JobLogger;
  /** Teto de itens por execução; o excedente fica para o próximo tick. */
  limit: number;
};

export type Job = {
  /** Nome único e estável, ex.: "payment.reconcile". Aparece nos logs e no `JOBS_ONLY`. */
  name: string;
  /** Intervalo entre execuções, em ms (o runner aplica jitter de ±10 %). Mínimo 1000. */
  everyMs: number;
  /** Chave do advisory lock do job; única no registro (ver `claimWithLock`). */
  lockKey: bigint;
  /** Itens por execução (padrão 100). */
  limit?: number;
  runOnce(ctx: JobContext): Promise<{ processed: number }>;
  /** Opcional: idade (ms) do item vencido mais antigo. Alimenta a métrica "atraso do job". */
  lagMs?(ctx: Omit<JobContext, "limit">): Promise<number | null>;
};

export type JobRunResult =
  | { status: "ok"; processed: number; durationMs: number; lagMs: number | null }
  | { status: "skipped"; reason: "overlap" | "stopping" }
  | { status: "failed"; error: string; durationMs: number };

export type JobStats = {
  name: string;
  everyMs: number;
  lastRunAt: string | null;
  lastStatus: "ok" | "failed" | null;
  lastDurationMs: number | null;
  lastProcessed: number | null;
  lagMs: number | null;
  consecutiveFailures: number;
  running: boolean;
};

export const DEFAULT_JOB_LIMIT = 100;
export const MIN_JOB_INTERVAL_MS = 1000;
