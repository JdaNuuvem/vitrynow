import type { Prisma, PrismaClient } from "@meucardapio/db";

export type ClaimResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Reivindica um lote sob `pg_try_advisory_xact_lock(lockKey)` dentro de uma transação CURTA
 * (ADR-0011 §2). Se outra instância já está reivindicando, devolve `{ acquired: false }` sem
 * esperar. Dentro de `claim`, marque os itens (`lockedUntil`/`claimedAt`) com
 * `SELECT … WHERE due FOR UPDATE SKIP LOCKED LIMIT n`; o trabalho pesado e as chamadas externas
 * rodam FORA desta transação, depois que ela confirma.
 */
export async function claimWithLock<T>(
  db: PrismaClient,
  lockKey: bigint,
  claim: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<ClaimResult<T>> {
  return db.$transaction(
    async (tx): Promise<ClaimResult<T>> => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${lockKey}) AS locked`;
      if (!rows[0]?.locked) return { acquired: false };
      return { acquired: true, value: await claim(tx) };
    },
    { timeout: 10_000, maxWait: 5_000 },
  );
}
