import { phaseOf, READ_ONLY_DAYS } from "../lib/entitlements";
import { utc } from "../lib/sqlTime";
import { PIX_EXPIRATION_MINUTES } from "./paymentExpire";
import { errorTag } from "./errorTag";
import { claimWithLock } from "./lock";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";

// Transição de fase da assinatura. NÃO muda regra de acesso: a fase continua calculada na leitura por `phaseOf` (pagar libera na hora).
// O job (1) grava a fase OBSERVADA e audita cada mudança (`subscription.phase_change`: TRIAL→READ_ONLY, ACTIVE→READ_ONLY, READ_ONLY→SUSPENDED,
// READ_ONLY/SUSPENDED→ACTIVE...), dando à plataforma o histórico de quem entrou em Consulta, foi suspenso ou voltou; e (2) expira cobranças PIX
// de assinatura esquecidas (PENDENTE além do prazo), que nunca mais serão pagas.
// Por nível e idempotente: só lê as assinaturas cuja fase PODE ter mudado; a gravação é condicional à fase lida (corrida = nada duplicado).
// Pendência de produto (assunção A4, aguarda o Claudio): período PAGO vencido ganha os mesmos 7 dias de Consulta do teste. Mantido como está.

export const subscriptionTransitionJob: Job = {
  name: "subscription.transition",
  everyMs: 5 * 60 * 1000,
  lockKey: JOB_LOCK_KEYS["subscription.transition"],
  limit: 500,
  async runOnce({ now, db, limit, log }) {
    const at = utc(now);
    const claimed = await claimWithLock(db, JOB_LOCK_KEYS["subscription.transition"], (tx) =>
      tx.$queryRaw<{ id: string; storeId: string; status: "TRIAL" | "ACTIVE" | "CANCELED"; trialEndsAt: Date; currentPeriodEnd: Date | null; phase: string | null }[]>`
        SELECT s."id", s."storeId", s."status"::text AS "status", s."trialEndsAt", s."currentPeriodEnd", s."phase" FROM "Subscription" s
         WHERE s."phase" IS NULL
            OR (s."phase" = 'TRIAL' AND (s."status" <> 'TRIAL' OR s."trialEndsAt" <= ${at}))
            OR (s."phase" = 'ACTIVE' AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd" <= ${at}))
            OR (s."phase" = 'READ_ONLY' AND (
                  (CASE WHEN s."status" = 'TRIAL' THEN s."trialEndsAt" ELSE coalesce(s."currentPeriodEnd", s."trialEndsAt") END) + make_interval(days => ${READ_ONLY_DAYS}::int) <= ${at}
                  OR (s."status" <> 'TRIAL' AND s."currentPeriodEnd" > ${at})))
            OR (s."phase" = 'SUSPENDED' AND s."status" <> 'TRIAL' AND s."currentPeriodEnd" > ${at})
         ORDER BY s."id" LIMIT ${limit}
         FOR UPDATE OF s SKIP LOCKED`,
    );
    if (!claimed.acquired) return { processed: 0 };

    let processed = 0;
    for (const s of claimed.value) {
      try {
        const { phase } = phaseOf(s, now);
        if (phase === s.phase) continue;
        const moved = await db.$transaction(async (tx) => {
          const updated = await tx.subscription.updateMany({ where: { id: s.id, phase: s.phase }, data: { phase, phaseChangedAt: now } });
          if (updated.count !== 1) return false;
          // Primeira observação (fase nula) é só a linha de base: não é uma "mudança" e não gera auditoria.
          if (s.phase !== null) {
            await tx.auditLog.create({ data: { storeId: s.storeId, action: "subscription.phase_change", targetType: "Subscription", targetId: s.id, metadata: { from: s.phase, to: phase, status: s.status }, createdAt: now } });
          }
          return true;
        });
        if (moved) processed += 1;
      } catch (error) {
        log.error({ subscriptionId: s.id, ...errorTag(error) }, "subscription.transition: falha ao gravar a fase");
      }
    }

    // Cobrança PIX de assinatura pendente além do prazo: nunca será paga. O webhook, se chegar depois, ainda é conciliado pelo id do provedor.
    const expired = await db.subscriptionPayment.updateMany({
      where: {
        status: "PENDENTE",
        OR: [{ expiresAt: { lte: now } }, { expiresAt: null, createdAt: { lte: new Date(now.getTime() - PIX_EXPIRATION_MINUTES * 60_000) } }],
      },
      data: { status: "EXPIRADO" },
    });
    return { processed: processed + expired.count };
  },
};
