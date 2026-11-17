import { Prisma, type prisma as prismaClient, type PrintMode } from "@meucardapio/db";
import type { AuditLogger } from "../../shared/audit";

type Db = typeof prismaClient;

// Relógio do BANCO em UTC (mesma convenção do claim: colunas TIMESTAMP sem fuso, gravadas em UTC).
const NOW = Prisma.raw("(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')");

// Modo de impressão da loja decidido pelo SERVIDOR (ADR-0004 §8.12): LEGACY = o cliente lista pedidos com printedAt nulo;
// QUEUE = o cliente consome jobs. Só um dos dois caminhos funciona por vez (o servidor impede a impressão em dobro).
export async function loadPrintMode(db: Pick<Db, "store">, storeId: string): Promise<PrintMode> {
  const store = await db.store.findUnique({ where: { id: storeId }, select: { printMode: true } });
  return store?.printMode ?? "LEGACY";
}

// As 3 consultas de conferência do plano de virada (Ritchie, plano-virada-printjobs.md). Todas devem dar 0 no sentido certo.
export type PrintConference = {
  // R1b: job PENDING de pedido que o legado já imprimiu ⇒ reimprimiria. (0 depois de LEGACY→QUEUE)
  pendingJobOfPrintedOrder: number;
  // R1: pedido imprimível (não impresso, não cancelado, não aguardando pagamento) SEM job ORDER_KITCHEN ⇒ nunca imprimiria. (0 depois de LEGACY→QUEUE)
  printableOrderWithoutJob: number;
  // R2: job PRINTED de pedido com printedAt nulo ⇒ o legado reimprimiria. (0 depois de QUEUE→LEGACY)
  printedJobOfUnprintedOrder: number;
};

export type PrintModeChange = {
  mode: PrintMode;
  changed: boolean;
  reconciled: { closedPendingJobs: number; createdJobs: number; markedOrdersPrinted: number };
  conference: PrintConference;
};

export class PrintModeService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogger,
  ) {}

  async get(storeId: string) {
    return { mode: await loadPrintMode(this.db, storeId), conference: await this.conference(this.db, storeId) };
  }

  async conference(db: Pick<Db, "$queryRaw">, storeId: string): Promise<PrintConference> {
    const [r1b] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "PrintJob" j JOIN "Order" o ON o."id" = j."orderId"
       WHERE j."storeId" = ${storeId} AND o."storeId" = ${storeId}
         AND j."kind" = 'ORDER_KITCHEN' AND j."status" = 'PENDING' AND o."printedAt" IS NOT NULL`;
    const [r1] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Order" o
       WHERE o."storeId" = ${storeId} AND o."printedAt" IS NULL AND o."status" <> 'CANCELADO' AND o."awaitingPayment" = false
         AND NOT EXISTS (SELECT 1 FROM "PrintJob" j WHERE j."orderId" = o."id" AND j."kind" = 'ORDER_KITCHEN')`;
    const [r2] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Order" o JOIN "PrintJob" j ON j."orderId" = o."id"
       WHERE o."storeId" = ${storeId} AND j."storeId" = ${storeId}
         AND j."kind" = 'ORDER_KITCHEN' AND j."status" = 'PRINTED' AND o."printedAt" IS NULL`;
    return { pendingJobOfPrintedOrder: Number(r1b.n), printableOrderWithoutJob: Number(r1.n), printedJobOfUnprintedOrder: Number(r2.n) };
  }

  // Troca o modo e RECONCILIA no mesmo ato, numa transação com lock por loja: a virada é atômica entre todas as impressoras
  // (o cliente lê o modo a cada ciclo) e idempotente (repetir o comando não muda nada). Só o OWNER chama (a rota exige).
  async set(actor: { storeId: string; userId: string }, target: PrintMode): Promise<PrintModeChange> {
    const result = await this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"printmode:" + actor.storeId}))`;
        const current = await loadPrintMode(tx, actor.storeId);
        const reconciled = target === "QUEUE" ? await this.toQueue(tx, actor.storeId) : await this.toLegacy(tx, actor.storeId);
        if (current !== target) await tx.store.update({ where: { id: actor.storeId }, data: { printMode: target } });
        const conference = await this.conference(tx, actor.storeId);
        return { mode: target, changed: current !== target, from: current, reconciled, conference };
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
    if (result.changed) {
      // Só contagens: nada de pedido, cliente nem contato na linha de auditoria.
      this.audit.log({
        storeId: actor.storeId,
        userId: actor.userId,
        action: "print.mode_change",
        targetType: "Store",
        targetId: actor.storeId,
        metadata: { from: result.from, to: result.mode, ...result.reconciled },
      });
    }
    const { from: _from, ...rest } = result;
    void _from;
    return rest;
  }

  // LEGACY → QUEUE
  private async toQueue(tx: Prisma.TransactionClient, storeId: string) {
    // R1b: job PENDING de pedido que o legado já imprimiu vira PRINTED (senão a fila reimprimiria tudo).
    const closed = await tx.$executeRaw`
      UPDATE "PrintJob" j
         SET "status" = 'PRINTED', "printedAt" = o."printedAt", "ackStatus" = 'PRINTED', "leaseUntil" = NULL, "updatedAt" = ${NOW}
        FROM "Order" o
       WHERE o."id" = j."orderId" AND j."storeId" = ${storeId} AND o."storeId" = ${storeId}
         AND j."kind" = 'ORDER_KITCHEN' AND j."status" = 'PENDING' AND o."printedAt" IS NOT NULL`;
    // R1: pedido imprimível sem job ganha o job do fluxo normal (mesma dedupeKey: "<orderId>:ORDER_KITCHEN").
    const created = await tx.$executeRaw`
      INSERT INTO "PrintJob" ("id", "storeId", "kind", "orderId", "maxAttempts", "dedupeKey", "availableAt", "createdAt", "updatedAt")
      SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), o."storeId", 'ORDER_KITCHEN', o."id", 3, o."id" || ':ORDER_KITCHEN', ${NOW}, ${NOW}, ${NOW}
        FROM "Order" o
       WHERE o."storeId" = ${storeId} AND o."printedAt" IS NULL AND o."status" <> 'CANCELADO' AND o."awaitingPayment" = false
         AND NOT EXISTS (SELECT 1 FROM "PrintJob" j WHERE j."orderId" = o."id" AND j."kind" = 'ORDER_KITCHEN')
      ON CONFLICT ("dedupeKey") DO NOTHING`;
    return { closedPendingJobs: closed, createdJobs: created, markedOrdersPrinted: 0 };
  }

  // QUEUE → LEGACY (recuo)
  private async toLegacy(tx: Prisma.TransactionClient, storeId: string) {
    // R2: pedido que a fila já imprimiu mas ficou com printedAt nulo seria reimpresso pelo legado.
    const marked = await tx.$executeRaw`
      UPDATE "Order" o
         SET "printedAt" = j."printedAt"
        FROM "PrintJob" j
       WHERE j."orderId" = o."id" AND o."storeId" = ${storeId} AND j."storeId" = ${storeId}
         AND j."kind" = 'ORDER_KITCHEN' AND j."status" = 'PRINTED' AND j."printedAt" IS NOT NULL AND o."printedAt" IS NULL`;
    return { closedPendingJobs: 0, createdJobs: 0, markedOrdersPrinted: marked };
  }
}
