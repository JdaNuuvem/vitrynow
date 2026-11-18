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
// Lotes por tick: queda geral de rede derruba TODOS os clientes ao mesmo tempo; um lote só (`limit`) deixaria as lojas além dele sem alerta.
export const QUEUE_WATCH_MAX_BATCHES = 5;

export const queueWatchJob: Job = {
  name: "print.queue_watch",
  everyMs: 60_000,
  lockKey: JOB_LOCK_KEYS["print.queue_watch"],
  limit: 200,
  async runOnce({ now, db, limit, log }) {
    const cutoff = new Date(now.getTime() - QUEUE_WATCH_MINUTES * 60_000);
    const service = new DeviceAlertService(db, publishToStore, () => now);
    // Quem já foi tratado NESTE tick (com sucesso ou não) não volta no lote seguinte: o tick termina e ninguém é alertado duas vezes à toa.
    const done: string[] = [];
    let processed = 0;
    for (let batch = 0; batch < QUEUE_WATCH_MAX_BATCHES; batch += 1) {
      // JUSTIÇA entre lojas: quem foi alertado há MAIS tempo (ou nunca: NULLS FIRST) vem primeiro. Com `ORDER BY id` fixo, 230 lojas paradas
      // processavam sempre as MESMAS 200 e as 30 de id maior ficavam sem alerta para sempre.
      const claimed = await claimWithLock(db, JOB_LOCK_KEYS["print.queue_watch"], (tx) =>
        tx.$queryRaw<{ storeId: string }[]>`
          SELECT s."id" AS "storeId" FROM "Store" s
           WHERE s."printMode" = 'QUEUE'
             AND EXISTS (SELECT 1 FROM "PrintJob" j
                          WHERE j."storeId" = s."id" AND j."status" = 'PENDING' AND j."kind" <> 'TEST'
                            AND j."availableAt" <= ${utc(cutoff)} AND j."createdAt" <= ${utc(cutoff)})
             AND NOT EXISTS (SELECT 1 FROM "PrintJob" c WHERE c."storeId" = s."id" AND c."claimedAt" >= ${utc(cutoff)})
             AND NOT (s."id" = ANY(${done}::text[]))
           ORDER BY (SELECT max(a."lastAt") FROM "DeviceAlert" a WHERE a."storeId" = s."id" AND a."code" = 'QUEUE_WITHOUT_PRINTER'::"DeviceAlertCode") ASC NULLS FIRST,
                    s."id"
           LIMIT ${limit}`,
      );
      if (!claimed.acquired) break;
      for (const { storeId } of claimed.value) {
        done.push(storeId);
        try {
          await service.record({ storeId, tokenId: null, code: "QUEUE_WITHOUT_PRINTER" });
          processed += 1;
        } catch (error) {
          log.error({ storeId, error: String(error) }, "queue_watch: falha ao gravar o alerta");
        }
      }
      if (claimed.value.length < limit) break;
    }
    return { processed };
  },
  async lagMs({ now, db }) {
    const rows = await db.$queryRaw<{ oldest: Date | null }[]>`
      SELECT min(j."createdAt") AS oldest FROM "PrintJob" j JOIN "Store" s ON s."id" = j."storeId"
       WHERE s."printMode" = 'QUEUE' AND j."status" = 'PENDING' AND j."kind" <> 'TEST'`;
    const oldest = rows[0]?.oldest;
    return oldest ? Math.max(0, now.getTime() - oldest.getTime()) : null;
  },
};
