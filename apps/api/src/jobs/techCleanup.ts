import type { Prisma } from "@meucardapio/db";
import { claimWithLock } from "./lock";
import { utc } from "../lib/sqlTime";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";

// `tech.cleanup` (ADR-0011 §3/§4): apaga SOMENTE tabelas técnicas expiradas. Nenhum dado de
// negócio (pedido, cliente, caixa, pagamento, auditoria, cardápio) é tocado por job algum — decisão
// do Claudio ("dados nunca apagados"). A lista de permissão é fechada: acrescentar uma tabela exige
// editar TARGETS e o teste de contrato (tests/jobs/tech-cleanup.test.ts), o que aparece na revisão.

/** Tempo que um registro técnico expirado ainda fica (ajuda a diagnosticar suporte). */
export const TECH_RETENTION_MS = 24 * 60 * 60 * 1000;

type Target = {
  /** IDs vencidos, travados com FOR UPDATE SKIP LOCKED (outra instância pula os mesmos). */
  claim(tx: Prisma.TransactionClient, cutoff: Date, limit: number): Promise<string[]>;
  remove(tx: Prisma.TransactionClient, ids: string[]): Promise<number>;
  oldestExpiry(tx: Prisma.TransactionClient): Promise<Date | null>;
};

const TARGETS = {
  PasswordResetToken: {
    async claim(tx, cutoff, limit) {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PasswordResetToken" WHERE "expiresAt" < ${utc(cutoff)}
        ORDER BY "expiresAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      return rows.map((row) => row.id);
    },
    async remove(tx, ids) {
      return (await tx.passwordResetToken.deleteMany({ where: { id: { in: ids } } })).count;
    },
    async oldestExpiry(tx) {
      return (await tx.passwordResetToken.aggregate({ _min: { expiresAt: true } }))._min.expiresAt;
    },
  },
  MfaChallenge: {
    async claim(tx, cutoff, limit) {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "MfaChallenge" WHERE "expiresAt" < ${utc(cutoff)}
        ORDER BY "expiresAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      return rows.map((row) => row.id);
    },
    async remove(tx, ids) {
      return (await tx.mfaChallenge.deleteMany({ where: { id: { in: ids } } })).count;
    },
    async oldestExpiry(tx) {
      return (await tx.mfaChallenge.aggregate({ _min: { expiresAt: true } }))._min.expiresAt;
    },
  },
  // SEC-19 / ST-30: sessões encerradas (logout de um aparelho). Linha só serve até o exp do token;
  // depois da retenção é lixo técnico. A chave primária é o `sid`.
  RevokedSession: {
    async claim(tx, cutoff, limit) {
      const rows = await tx.$queryRaw<{ sid: string }[]>`
        SELECT "sid" FROM "RevokedSession" WHERE "expiresAt" < ${utc(cutoff)}
        ORDER BY "expiresAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      return rows.map((row) => row.sid);
    },
    async remove(tx, ids) {
      return (await tx.revokedSession.deleteMany({ where: { sid: { in: ids } } })).count;
    },
    async oldestExpiry(tx) {
      return (await tx.revokedSession.aggregate({ _min: { expiresAt: true } }))._min.expiresAt;
    },
  },
  // PC-24: alertas de dispositivo (telemetria): `expiresAt` = último aviso + 30 dias. Sem PII por construção.
  DeviceAlert: {
    async claim(tx, cutoff, limit) {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "DeviceAlert" WHERE "expiresAt" < ${utc(cutoff)}
        ORDER BY "expiresAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      return rows.map((row) => row.id);
    },
    async remove(tx, ids) {
      return (await tx.deviceAlert.deleteMany({ where: { id: { in: ids } } })).count;
    },
    async oldestExpiry(tx) {
      return (await tx.deviceAlert.aggregate({ _min: { expiresAt: true } }))._min.expiresAt;
    },
  },
  // API-07 / ADR-0011 §4: `state` do OAuth do Mercado Pago (só o hash; uso único; vale 10 min). Vencido ou usado é lixo técnico.
  PaymentOAuthState: {
    async claim(tx, cutoff, limit) {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PaymentOAuthState" WHERE "expiresAt" < ${utc(cutoff)}
        ORDER BY "expiresAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      return rows.map((row) => row.id);
    },
    async remove(tx, ids) {
      return (await tx.paymentOAuthState.deleteMany({ where: { id: { in: ids } } })).count;
    },
    async oldestExpiry(tx) {
      return (await tx.paymentOAuthState.aggregate({ _min: { expiresAt: true } }))._min.expiresAt;
    },
  },
} satisfies Record<string, Target>;

export type TechTable = keyof typeof TARGETS;
export const TECH_CLEANUP_ALLOWLIST = Object.keys(TARGETS) as TechTable[];

export const techCleanupJob: Job = {
  name: "tech.cleanup",
  everyMs: 24 * 60 * 60 * 1000,
  lockKey: JOB_LOCK_KEYS["tech.cleanup"],
  limit: 500,
  async runOnce({ now, db, limit, log }) {
    const cutoff = new Date(now.getTime() - TECH_RETENTION_MS);
    const claimed = await claimWithLock(db, JOB_LOCK_KEYS["tech.cleanup"], async (tx) => {
      let processed = 0;
      for (const table of TECH_CLEANUP_ALLOWLIST) {
        const target: Target = TARGETS[table];
        const ids = await target.claim(tx, cutoff, limit);
        if (ids.length === 0) continue;
        const removed = await target.remove(tx, ids);
        processed += removed;
        log.info({ job: "tech.cleanup", table, removed }, "tech.cleanup.removed");
      }
      // API-13 (LGPD, Nightingale/Atlas): a impressão digital da idempotência do pedido manual só serve por minutos; depois da retenção o valor é zerado
      // (a janela útil acabou e o hash derivado de dados do cliente não deve ficar guardado). NÃO apaga nem altera o pedido: só esta coluna.
      const scrubbed = await tx.$executeRaw`
        UPDATE "Order" SET "manualBodyHash" = NULL
         WHERE "id" IN (SELECT "id" FROM "Order" WHERE "manualBodyHash" IS NOT NULL AND "createdAt" < ${utc(cutoff)}
                         ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`;
      if (scrubbed > 0) log.info({ job: "tech.cleanup", column: "Order.manualBodyHash", scrubbed }, "tech.cleanup.scrubbed");
      processed += scrubbed;
      return processed;
    });
    return { processed: claimed.acquired ? claimed.value : 0 };
  },
  async lagMs({ now, db }) {
    let oldest: Date | null = null;
    for (const table of TECH_CLEANUP_ALLOWLIST) {
      const expiry = await (TARGETS[table] as Target).oldestExpiry(db as unknown as Prisma.TransactionClient);
      if (expiry && (!oldest || expiry < oldest)) oldest = expiry;
    }
    if (!oldest) return null;
    const lag = now.getTime() - oldest.getTime() - TECH_RETENTION_MS;
    return lag > 0 ? lag : null;
  },
};
