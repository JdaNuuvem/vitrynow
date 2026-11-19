import { getObjectStorage } from "../lib/objectStorage";
import { getReelTranscoder } from "../lib/reelTranscoder";
import { ReelsService } from "../modules/reels/reels.service";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";

// `reels.convert` (ADR-0021): fila de mídia no Postgres (SKIP LOCKED + lease). Converte os vídeos pendentes (UM por vez no servidor,
// UM por loja: regra do `claimJob`) e roda o varredor: original órfão da quarentena (> 1 h), vídeo de produto apagado, job sem andamento.
// Em produção roda no contêiner `worker` (JOBS_ONLY=reels.convert), o único com ffmpeg.
export const REELS_CONVERT_BATCH = 3;

export const reelsConvertJob: Job = {
  name: "reels.convert",
  everyMs: 10_000,
  lockKey: JOB_LOCK_KEYS["reels.convert"],
  limit: REELS_CONVERT_BATCH,
  async runOnce({ db, limit, log }) {
    const service = new ReelsService(db, getObjectStorage(), getReelTranscoder);
    let processed = 0;
    while (processed < limit && (await service.runNext())) processed += 1;
    const swept = await service.sweep();
    if (swept.originalsDeleted + swept.originalsFailed + swept.orphanProductReels + swept.stalled > 0) log.info({ ...swept }, "reels.sweep");
    if (swept.originalsFailed > 0) log.warn({ originalsFailed: swept.originalsFailed }, "reels: falha ao apagar original da quarentena (será repetido)");
    return { processed: processed + swept.originalsDeleted + swept.orphanProductReels };
  },
  async lagMs({ now, db }) {
    const oldest = await db.mediaJob.findFirst({ where: { kind: "REEL_CONVERT", status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    return oldest ? Math.max(0, now.getTime() - oldest.createdAt.getTime()) : null;
  },
};
