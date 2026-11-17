import { claimWithLock } from "./lock";
import { utc } from "../lib/sqlTime";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";
import { DeviceAlertService } from "../modules/deviceAlerts/deviceAlerts.service";
import { publishToStore } from "../realtime/hub";

// PC-24b — detector no SERVIDOR (não depende do PC da loja): loja em QUEUE com tíquete esperando há mais de N minutos e NENHUM claim nesse
// intervalo ⇒ alerta `QUEUE_WITHOUT_PRINTER` (cozinha sem tíquete). Cobre impressora desligada, cliente travado, cliente antigo ainda no legado
// e rede fora. Idempotente e "por nível": cada tick reavalia e o dedupe da janela de 10 min junta as repetições.
export const QUEUE_WATCH_MINUTES = 5;

export const queueWatchJob: Job = {
  name: "print.queue_watch",
  everyMs: 60_000,
  lockKey: JOB_LOCK_KEYS["print.queue_watch"],
  limit: 200,
  async runOnce({ now, db, limit, log }) {
    const cutoff = new Date(now.getTime() - QUEUE_WATCH_MINUTES * 60_000);
    const claimed = await claimWithLock(db, JOB_LOCK_KEYS["print.queue_watch"], (tx) =>
      tx.$queryRaw<{ storeId: string }[]>`
        SELECT s."id" AS "storeId" FROM "Store" s
         WHERE s."printMode" = 'QUEUE'
           AND EXISTS (SELECT 1 FROM "PrintJob" j
                        WHERE j."storeId" = s."id" AND j."status" = 'PENDING' AND j."kind" <> 'TEST'
                          AND j."availableAt" <= ${utc(cutoff)} AND j."createdAt" <= ${utc(cutoff)})
           AND NOT EXISTS (SELECT 1 FROM "PrintJob" c WHERE c."storeId" = s."id" AND c."claimedAt" >= ${utc(cutoff)})
         ORDER BY s."id" LIMIT ${limit}`,
    );
    if (!claimed.acquired) return { processed: 0 };
    const service = new DeviceAlertService(db, publishToStore, () => now);
    let processed = 0;
    for (const { storeId } of claimed.value) {
      try {
        await service.record({ storeId, tokenId: null, code: "QUEUE_WITHOUT_PRINTER" });
        processed += 1;
      } catch (error) {
        log.error({ storeId, error: String(error) }, "queue_watch: falha ao gravar o alerta");
      }
    }
    return { processed };
  },
  async lagMs({ now, db }) {
    const rows = await db.$queryRaw<{ oldest: Date | null }[]>`
      SELECT min("createdAt") AS oldest FROM "PrintJob" j JOIN "Store" s ON s."id" = j."storeId"
       WHERE s."printMode" = 'QUEUE' AND j."status" = 'PENDING' AND j."kind" <> 'TEST'`;
    const oldest = rows[0]?.oldest;
    return oldest ? Math.max(0, now.getTime() - oldest.getTime()) : null;
  },
};
