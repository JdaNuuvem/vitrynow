import { errorTag } from "./errorTag";
import { utc } from "../lib/sqlTime";
import { enqueueOrderTicket } from "../modules/printJobs/printJobs.queue";
import { publishToStore } from "../realtime/hub";
import { claimWithLock } from "./lock";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";

// API-40 — solta o pedido agendado. Por nível e idempotente: cada tick acha TODO retido cuja hora de liberar (scheduledFor - tempo de
// preparo do tipo) já passou, que não aguarda pagamento e não foi cancelado. Soltar = `held` true→false (condicional) + tíquete na MESMA
// transação; os eventos saem depois do commit. Pedido cancelado continua retido (fora do kanban), nunca é apagado.

const dueSql = (now: Date) => utc(now);

export const scheduleReleaseJob: Job = {
  name: "schedule.release",
  everyMs: 30_000,
  lockKey: JOB_LOCK_KEYS["schedule.release"],
  limit: 100,
  async runOnce({ now, db, limit, log }) {
    const failed: string[] = [];
    let processed = 0;
    for (let batch = 0; batch < 5; batch += 1) {
      const claimed = await claimWithLock(db, JOB_LOCK_KEYS["schedule.release"], (tx) =>
        tx.$queryRaw<{ id: string; storeId: string }[]>`
          SELECT o."id", o."storeId" FROM "Order" o JOIN "Store" s ON s."id" = o."storeId"
           WHERE o."held" = true AND o."awaitingPayment" = false AND o."status" <> 'CANCELADO' AND NOT (o."id" = ANY(${failed}::text[]))
             AND o."scheduledFor" - make_interval(mins => CASE WHEN o."type" = 'DELIVERY' THEN coalesce(s."prepMinutesDelivery", 0) ELSE coalesce(s."prepMinutesPickup", 0) END) <= ${dueSql(now)}
           ORDER BY o."scheduledFor" ASC LIMIT ${limit}
           FOR UPDATE OF o SKIP LOCKED`,
      );
      if (!claimed.acquired) break;
      for (const { id, storeId } of claimed.value) {
        try {
          const released = await db.$transaction(async (tx) => {
            const moved = await tx.order.updateMany({ where: { id, storeId, held: true, awaitingPayment: false, status: { not: "CANCELADO" } }, data: { held: false } });
            if (moved.count !== 1) return null; // outra via já soltou ou o pedido mudou
            return { queued: await enqueueOrderTicket(tx, { id, storeId }) };
          });
          if (released) {
            publishToStore(storeId, { type: "order.created", orderId: id });
            if (released.queued) publishToStore(storeId, { type: "print.available" });
            processed += 1;
          }
        } catch (error) {
          failed.push(id);
          log.error({ orderId: id, ...errorTag(error) }, "schedule.release: falha ao soltar o pedido agendado");
        }
      }
      if (claimed.value.length < limit) break;
    }
    return { processed };
  },
  async lagMs({ now, db }) {
    const rows = await db.$queryRaw<{ oldest: Date | null }[]>`
      SELECT min(o."scheduledFor" - make_interval(mins => CASE WHEN o."type" = 'DELIVERY' THEN coalesce(s."prepMinutesDelivery", 0) ELSE coalesce(s."prepMinutesPickup", 0) END)) AS oldest
        FROM "Order" o JOIN "Store" s ON s."id" = o."storeId"
       WHERE o."held" = true AND o."awaitingPayment" = false AND o."status" <> 'CANCELADO'`;
    const oldest = rows[0]?.oldest;
    return oldest ? Math.max(0, now.getTime() - oldest.getTime()) : null;
  },
};
