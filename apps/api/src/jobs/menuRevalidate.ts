import { claimWithLock } from "./lock";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";
import { callWebRevalidate, REVALIDATE_MAX_ATTEMPTS, revalidateBackoffMs, revalidateConfig } from "../lib/menuRevalidation";

// `menu.revalidate` (ADR-0011/0013): envia ao web os pedidos pendentes de "refaça a vitrine" e reenvia os que falharam,
// com recuo. Idempotente: revalidar duas vezes é inofensivo. O intervalo curto (3 s) mantém a vitrine em ≤ 5 s mesmo
// quando o envio imediato do gancho da API não pôde rodar (outro envio em andamento, API reiniciada).

const LEASE_MS = 30_000; // um item reivindicado não é pego por outra instância durante este prazo

type Claimed = { slug: string; requestedAt: Date; attempts: number };

export const menuRevalidateJob: Job = {
  name: "menu.revalidate",
  everyMs: 3000,
  lockKey: JOB_LOCK_KEYS["menu.revalidate"],
  limit: 50,
  async runOnce({ now, db, limit, log }) {
    const config = revalidateConfig();
    if (!config) return { processed: 0 };

    // 1) reivindica o lote numa transação curta (SKIP LOCKED; ADR-0011 §2)
    const claim = await claimWithLock(db, JOB_LOCK_KEYS["menu.revalidate"], (tx) =>
      tx.$queryRaw<Claimed[]>`
        UPDATE "MenuRevalidation"
        SET "attempts" = "attempts" + 1, "nextAttemptAt" = ${new Date(now.getTime() + LEASE_MS)}
        WHERE "slug" IN (
          SELECT "slug" FROM "MenuRevalidation"
          WHERE "nextAttemptAt" <= ${now}
          ORDER BY "nextAttemptAt"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "slug", "requestedAt", "attempts"`,
    );
    if (!claim.acquired) return { processed: 0 };

    // 2) chamadas externas FORA da transação
    let processed = 0;
    for (const item of claim.value) {
      try {
        await callWebRevalidate(item.slug, config);
        // só apaga se NÃO chegou pedido mais novo durante o envio (requestedAt mudaria)
        await db.menuRevalidation.deleteMany({ where: { slug: item.slug, requestedAt: item.requestedAt } });
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (item.attempts >= REVALIDATE_MAX_ATTEMPTS) {
          // desiste: o TTL do ISR cobre; não deixa a fila crescer
          await db.menuRevalidation.deleteMany({ where: { slug: item.slug, requestedAt: item.requestedAt } });
          log.warn({ job: "menu.revalidate", slug: item.slug, attempts: item.attempts, error: message }, "menu.revalidate.gave_up");
        } else {
          await db.menuRevalidation.updateMany({
            where: { slug: item.slug, requestedAt: item.requestedAt },
            data: { nextAttemptAt: new Date(now.getTime() + revalidateBackoffMs(item.attempts)) },
          });
          log.warn({ job: "menu.revalidate", slug: item.slug, attempts: item.attempts, error: message }, "menu.revalidate.retry");
        }
      }
    }
    return { processed };
  },
  async lagMs({ now, db }) {
    const oldest = await db.menuRevalidation.aggregate({ _min: { nextAttemptAt: true } });
    const due = oldest._min.nextAttemptAt;
    return due && due < now ? now.getTime() - due.getTime() : null;
  },
};
