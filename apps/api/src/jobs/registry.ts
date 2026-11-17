import type { PrismaClient } from "@meucardapio/db";
import { JobRunner, type JobRunnerOptions } from "./runner";
import { mpTokenRefreshJob } from "./mpTokenRefresh";
import { techCleanupJob } from "./techCleanup";
import { queueWatchJob } from "./queueWatch";
import type { Job } from "./types";

/**
 * Registro central dos jobs (ADR-0011 §3). Quem entrega um job acrescenta UMA linha aqui e uma
 * chave em `lockKeys.ts`; o teste de contrato (tests/jobs/registry.test.ts) confere nome, lock
 * único, intervalo e limite.
 */
export const registeredJobs: Job[] = [techCleanupJob, queueWatchJob, mpTokenRefreshJob];

export function createJobRunner(options: JobRunnerOptions & { db: PrismaClient }, jobs: Job[] = registeredJobs): JobRunner {
  const runner = new JobRunner(options);
  for (const job of jobs) runner.register(job);
  return runner;
}
