import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";
import { pollDish3dJobs } from "../lib/dish3d";

// `dish3d.poll` (PRATO 3D): consulta no provedor as gerações em andamento, guarda o GLB pronto no nosso armazenamento
// e devolve os créditos das que falharam. Idempotente (lease + SKIP LOCKED + update condicional ao status RUNNING).
export const dish3dPollJob: Job = {
  name: "dish3d.poll",
  everyMs: 10_000,
  lockKey: JOB_LOCK_KEYS["dish3d.poll"],
  limit: 10,
  async runOnce({ now, db, limit }) {
    return { processed: await pollDish3dJobs(now, limit, db) };
  },
  async lagMs({ now, db }) {
    const oldest = await db.dish3dJob.aggregate({ where: { status: "RUNNING" }, _min: { nextCheckAt: true } });
    const due = oldest._min.nextCheckAt;
    return due && due < now ? now.getTime() - due.getTime() : null;
  },
};
