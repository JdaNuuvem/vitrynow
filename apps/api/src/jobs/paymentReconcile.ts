import { errorTag } from "./errorTag";
import { utc } from "../lib/sqlTime";
import { prismaAuditLogger } from "../shared/audit";
import { gatewayForStore } from "../modules/storePayments/gateway";
import { PixUnavailableError } from "../modules/storePayments/storePayments.service";
import { paymentService } from "../modules/payments/payments.module";
import { claimWithLock } from "./lock";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";

// SEC-17 / ADR-0007 §6.3 — conciliação de PIX "órfão". O `Payment` nasce ANTES da chamada ao provedor (com `idempotencyKey`); se a chamada cai no meio
// (o provedor criou a cobrança mas não gravamos o id), o registro fica com `providerPaymentId = null` e o cliente ainda pode pagar um PIX que o sistema
// não conhece. Este job reencontra a cobrança REPETINDO a criação com a MESMA chave de idempotência (o provedor devolve a mesma cobrança, nunca outra),
// anexa o id e a conta, e então: cobrança ainda aberta de pedido já cancelado ⇒ cancela no provedor; qualquer outro estado ⇒ passa pelo mesmo caminho do
// webhook (pago depois de cancelado vira estorno). Cada registro é conferido uma única vez (`lastCheckedAt`); o que não dá para conferir fica auditado.
export const ORPHAN_GRACE_MINUTES = 3; // folga: a chamada original ainda pode estar em andamento

export const paymentReconcileJob: Job = {
  name: "payment.reconcile",
  everyMs: 120_000,
  lockKey: JOB_LOCK_KEYS["payment.reconcile"],
  limit: 50,
  async runOnce({ now, db, limit, log }) {
    const failed: string[] = [];
    let processed = 0;
    for (let batch = 0; batch < 5; batch += 1) {
      const claimed = await claimWithLock(db, JOB_LOCK_KEYS["payment.reconcile"], (tx) =>
        tx.$queryRaw<{ id: string; orderId: string; storeId: string; amountCents: number; idempotencyKey: string; code: number; storeName: string; orderStatus: string }[]>`
          SELECT p."id", p."orderId", o."storeId", p."amountCents", p."idempotencyKey", o."code", s."name" AS "storeName", o."status" AS "orderStatus"
            FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId" JOIN "Store" s ON s."id" = o."storeId"
           WHERE p."providerPaymentId" IS NULL AND p."idempotencyKey" IS NOT NULL AND p."lastCheckedAt" IS NULL
             AND p."status" IN ('PENDENTE', 'CANCELADO') AND NOT (p."id" = ANY(${failed}::text[]))
             AND p."createdAt" <= ${utc(new Date(now.getTime() - ORPHAN_GRACE_MINUTES * 60_000))}
           ORDER BY p."createdAt" ASC LIMIT ${limit}`,
      );
      if (!claimed.acquired) break;
      for (const row of claimed.value) {
        try {
          await reconcileOne(db, row, now);
          processed += 1;
        } catch (error) {
          failed.push(row.id); // falha transitória (provedor fora do ar): sem `lastCheckedAt`, o próximo tick tenta de novo
          log.error({ paymentId: row.id, ...errorTag(error) }, "payment.reconcile: falha ao conciliar a cobrança");
        }
      }
      if (claimed.value.length < limit) break;
    }
    return { processed };
  },
  async lagMs({ now, db }) {
    const rows = await db.$queryRaw<{ oldest: Date | null }[]>`
      SELECT min(p."createdAt") AS oldest FROM "Payment" p
       WHERE p."providerPaymentId" IS NULL AND p."idempotencyKey" IS NOT NULL AND p."lastCheckedAt" IS NULL AND p."status" IN ('PENDENTE', 'CANCELADO')`;
    const oldest = rows[0]?.oldest;
    return oldest ? Math.max(0, now.getTime() - oldest.getTime() - ORPHAN_GRACE_MINUTES * 60_000) : null;
  },
};

type Db = Parameters<NonNullable<Job["lagMs"]>>[0]["db"];
type Row = { id: string; orderId: string; storeId: string; amountCents: number; idempotencyKey: string; code: number; storeName: string; orderStatus: string };

async function reconcileOne(db: Db, row: Row, now: Date) {
  const audit = (action: string, metadata: Record<string, unknown> = {}) => prismaAuditLogger.log({ storeId: row.storeId, action, targetType: "Payment", targetId: row.id, metadata });
  const checked = () => db.payment.updateMany({ where: { id: row.id, providerPaymentId: null }, data: { lastCheckedAt: now } });

  let gateway;
  try {
    gateway = await gatewayForStore(row.storeId);
  } catch (error) {
    if (!(error instanceof PixUnavailableError)) throw error;
    // Conta da loja desconectada: não há como perguntar ao provedor. Fica registrado para o suporte (nunca silencioso).
    await checked();
    audit("payment.orphan_unverifiable");
    return;
  }
  // Mesma chave ⇒ o provedor devolve a cobrança que já criou (ou nenhuma cobrança nova viva: ela é cancelada logo abaixo).
  const charge = await gateway.createPixPayment({
    orderId: row.orderId,
    amountCents: row.amountCents,
    description: `Pedido #${row.code} — ${row.storeName}`,
    payerEmail: `cliente-${row.orderId}@checkout.meucardapio.local`,
    idempotencyKey: row.idempotencyKey,
  });
  const attached = await db.payment.updateMany({
    where: { id: row.id, providerPaymentId: null },
    data: { providerPaymentId: charge.providerPaymentId, paymentAccountId: gateway.accountId, lastCheckedAt: now },
  });
  if (attached.count !== 1) return; // o webhook chegou antes e já anexou: nada a fazer
  const order = await db.order.findUniqueOrThrow({ where: { id: row.orderId }, select: { status: true } });
  const stillOpen = charge.status === "pending" || charge.status === "in_process";
  if (stillOpen && order.status === "CANCELADO") {
    await gateway.cancelPayment(charge.providerPaymentId);
    await db.payment.updateMany({ where: { id: row.id, status: "PENDENTE" }, data: { status: "CANCELADO" } });
    audit("payment.orphan_cancelled", { providerStatus: charge.status });
    return;
  }
  audit("payment.orphan_attached", { providerStatus: charge.status, orderStatus: order.status });
  // Pago/estornado/etc. enquanto estava órfão: o mesmo caminho do webhook decide (aprovado depois de cancelado ⇒ estorno; nunca silencioso).
  if (!stillOpen) await paymentService.handleNotification(charge.providerPaymentId);
}
