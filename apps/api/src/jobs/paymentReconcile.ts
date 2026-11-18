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
// não conhece. Este job reencontra a cobrança por LEITURA (`findByExternalReference`: referência externa = id do pedido): NUNCA cria cobrança, então não
// depende da janela de validade da chave de idempotência nem do corpo ser idêntico (Nightingale C1/C2). Só olha linhas com menos de `ORPHAN_MAX_AGE_HOURS`;
// as mais velhas ficam auditadas (`payment.orphan_unverifiable`) para o suporte. Achada a cobrança: anexa o id e a conta, e então: cobrança ainda aberta de pedido já cancelado ⇒ cancela no provedor; qualquer outro estado ⇒ passa pelo mesmo caminho do
// webhook (pago depois de cancelado vira estorno). Cada registro é conferido uma única vez (`lastCheckedAt`); o que não dá para conferir fica auditado.
export const ORPHAN_GRACE_MINUTES = 3; // folga: a chamada original ainda pode estar em andamento
export const ORPHAN_MAX_AGE_HOURS = 12; // NÃO VERIFICADO no sandbox: acima disso o job não confia em reencontro e só audita

type Row = { id: string; orderId: string; storeId: string; amountCents: number; createdAt: Date; code: number; storeName: string; orderStatus: string };

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
        tx.$queryRaw<Row[]>`
          SELECT p."id", p."orderId", o."storeId", p."amountCents", p."createdAt", o."code", s."name" AS "storeName", o."status" AS "orderStatus"
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
  // Mais velha que o limite: não há como reencontrar com segurança; fica auditado e a linha não é tocada de novo.
  if (now.getTime() - row.createdAt.getTime() > ORPHAN_MAX_AGE_HOURS * 3_600_000) {
    await checked();
    audit("payment.orphan_unverifiable", { reason: "too_old" });
    return;
  }
  // SOMENTE LEITURA: pagamentos do provedor com a referência deste pedido e o MESMO valor (outro valor não é a nossa cobrança).
  const found = (await gateway.findByExternalReference(row.orderId)).filter((p) => p.externalReference === row.orderId && p.amountCents === row.amountCents && p.currency === "BRL");
  const rank = (s: string | null | undefined) => (s === "approved" ? 0 : s === "pending" || s === "in_process" ? 1 : 2);
  found.sort((a, b) => rank(a.status) - rank(b.status));
  const charge = found[0];
  if (!charge) {
    // O provedor não tem cobrança para este pedido: a chamada original nunca chegou lá. Nada a anexar; fica registrado e não repete.
    await checked();
    audit("payment.orphan_not_found");
    return;
  }
  const attached = await db.payment.updateMany({
    where: { id: row.id, providerPaymentId: null },
    data: { providerPaymentId: charge.providerPaymentId!, paymentAccountId: gateway.accountId, lastCheckedAt: now },
  });
  if (attached.count !== 1) return; // o webhook chegou antes e já anexou: nada a fazer
  const order = await db.order.findUniqueOrThrow({ where: { id: row.orderId }, select: { status: true } });
  const stillOpen = charge.status === "pending" || charge.status === "in_process";
  // Duplicatas abertas (mesma referência): só a escolhida fica ligada ao pedido; as outras abertas são canceladas no provedor (nunca ficam cobráveis).
  for (const extra of found.slice(1)) if (extra.status === "pending" || extra.status === "in_process") await gateway.cancelPayment(extra.providerPaymentId).catch(() => audit("payment.orphan_extra_cancel_failed"));
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
