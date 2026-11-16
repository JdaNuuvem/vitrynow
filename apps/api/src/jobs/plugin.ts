import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { createJobRunner } from "./registry";
import { jobsConfigFromEnv, type JobRunner } from "./runner";

declare module "fastify" {
  interface FastifyInstance {
    /** Executor de jobs do processo (ADR-0011). Só agenda com `JOBS_ENABLED` (padrão: desligado em teste). */
    jobs: JobRunner;
  }
}

// Registra o runner na API: agenda no `onReady` e para (esperando o lote corrente) no `onClose`,
// antes de o Prisma desconectar (o hook de desconexão foi registrado primeiro e roda por último).
const jobsPlugin: FastifyPluginAsync = async (app) => {
  const { enabled, only } = jobsConfigFromEnv();
  const runner = createJobRunner({ db: prisma, log: app.log, only });
  app.decorate("jobs", runner);

  app.addHook("onReady", async () => {
    if (!enabled) {
      app.log.info({ jobs: runner.names() }, "jobs.disabled");
      return;
    }
    runner.start();
    app.log.info({ jobs: runner.names(), only }, "jobs.started");
  });
  app.addHook("onClose", async () => {
    await runner.stop();
  });
};

export default fp(jobsPlugin, { name: "jobs" });
