import { errorTag } from "./errorTag";
import { MAX_REFUND_AUTO_ATTEMPTS } from "../modules/orders/orders.service";
import { orderService } from "../modules/orders/orders.module";
import { claimWithLock } from "./lock";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";

// API-06 — retentativa automática de estorno. Pagamento em ESTORNO_PENDENTE (o dinheiro ainda não voltou, ou voltou e falta fechar o cancelamento) é
// retentado por `attemptRefund` (idempotente: mesma chave no provedor, uma só devolução) enquanto `refundAttempts < MAX_REFUND_AUTO_ATTEMPTS`.
// Ao cruzar o teto o alerta único já sai de dentro do serviço (auditoria `order.refund_stuck`); depois disso só o "Tentar estorno" do dono age.
// Cada execução tenta uma vez cada pagamento (as tentativas ficam espaçadas pelo intervalo do job).
export const refundRetryJob: Job = {
  name: "refund.retry",
  everyMs: 120_000,
  lockKey: JOB_LOCK_KEYS["refund.retry"],
  limit: 50,
  async runOnce({ db, limit, log }) {
    const failed: string[] = [];
    let processed = 0;
    for (let batch = 0; batch < 5; batch += 1) {
    const claimed = await claimWithLock(db, JOB_LOCK_KEYS["refund.retry"], (tx) =>
      tx.$queryRaw<{ id: string }[]>`
        SELECT p."id" FROM "Payment" p
         WHERE p."status" = 'ESTORNO_PENDENTE' AND p."providerPaymentId" IS NOT NULL AND p."refundAttempts" < ${MAX_REFUND_AUTO_ATTEMPTS} AND p."refundAbandonedAt" IS NULL AND NOT (p."id" = ANY(${failed}::text[]))
         ORDER BY p."refundAttempts" ASC, p."refundRequestedAt" ASC NULLS FIRST LIMIT ${limit}`,
    );
    if (!claimed.acquired) break;
    for (const { id } of claimed.value) {
      try {
        await orderService.attemptRefund(id);
        processed += 1;
      } catch (error) {
        failed.push(id);
        log.error({ paymentId: id, ...errorTag(error) }, "refund.retry: falha ao retentar o estorno");
      }
    }
    if (claimed.value.length < limit) break;
    }
    return { processed };
  },
};
