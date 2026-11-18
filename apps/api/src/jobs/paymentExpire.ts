import { errorTag } from "./errorTag";
import { utc } from "../lib/sqlTime";
import { orderService } from "../modules/orders/orders.module";
import { claimWithLock } from "./lock";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";

// API-06 — expiração do PIX. Pedido que aguarda pagamento (PIX pendente) e passou do prazo é cancelado pelo SISTEMA, sempre por
// `cancelBySystem` (único caminho de cancelamento: ele trava a loja primeiro, resolve a corrida com um pagamento aprovado agora e, se o
// dinheiro já entrou, vira estorno). O job é "por nível" e idempotente: cada tick reavalia tudo o que venceu.
// Prazo = o menor entre o `expiresAt` do provedor e a criação + 30 min (constante única do PIX).
export const PIX_EXPIRATION_MINUTES = 30;

export const paymentExpireJob: Job = {
  name: "payment.expire",
  everyMs: 60_000,
  lockKey: JOB_LOCK_KEYS["payment.expire"],
  limit: 100,
  async runOnce({ now, db, limit, log }) {
    // Quem FALHOU neste tick sai dos lotes seguintes: falha persistente de 100+ pedidos não bloqueia os demais (até 5 lotes por tick).
    const failed: string[] = [];
    let processed = 0;
    for (let batch = 0; batch < 5; batch += 1) {
    const claimed = await claimWithLock(db, JOB_LOCK_KEYS["payment.expire"], (tx) =>
      tx.$queryRaw<{ id: string; storeId: string }[]>`
        SELECT o."id", o."storeId" FROM "Order" o JOIN "Payment" p ON p."orderId" = o."id"
         WHERE o."awaitingPayment" = true AND o."status" <> 'CANCELADO' AND p."status" = 'PENDENTE' AND NOT (o."id" = ANY(${failed}::text[]))
           AND LEAST(COALESCE(p."expiresAt", p."createdAt" + make_interval(mins => ${PIX_EXPIRATION_MINUTES}::int)), p."createdAt" + make_interval(mins => ${PIX_EXPIRATION_MINUTES}::int)) <= ${utc(now)}
         ORDER BY p."createdAt" ASC LIMIT ${limit}`,
    );
    if (!claimed.acquired) break;
    for (const { id, storeId } of claimed.value) {
      try {
        await orderService.cancelExpiredPix(storeId, id);
        processed += 1;
      } catch (error) {
        failed.push(id);
        log.error({ orderId: id, ...errorTag(error) }, "payment.expire: falha ao cancelar o pedido");
      }
    }
    if (claimed.value.length < limit) break;
    }
    return { processed };
  },
  async lagMs({ now, db }) {
    const rows = await db.$queryRaw<{ oldest: Date | null }[]>`
      SELECT min(p."createdAt") AS oldest FROM "Order" o JOIN "Payment" p ON p."orderId" = o."id"
       WHERE o."awaitingPayment" = true AND o."status" <> 'CANCELADO' AND p."status" = 'PENDENTE'`;
    const oldest = rows[0]?.oldest;
    return oldest ? Math.max(0, now.getTime() - oldest.getTime() - PIX_EXPIRATION_MINUTES * 60_000) : null;
  },
};
