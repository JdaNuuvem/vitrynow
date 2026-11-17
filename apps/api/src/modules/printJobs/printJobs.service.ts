import { Prisma, type prisma as prismaClient, type PrintJob, type PrintKind, type PrintJobStatus } from "@meucardapio/db";
import type { PrintableOrder, WsServerMessage } from "@meucardapio/shared-types";
import { CodedError } from "../../shared/errors";
import type { AuditLogger } from "../../shared/audit";
import { buildPrintableOrder, buildTestTicket } from "../../lib/printable";
import {
  BACKOFF_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
  FAILURE_MESSAGES,
  MAX_REPRINTS_PER_ORDER,
  leaseSeconds,
  normalizeFailureCode,
  sanitizeDeviceText,
  type FailureCode,
} from "../../lib/printJobs";

type Db = typeof prismaClient;

// Relógio do BANCO em UTC (as colunas são TIMESTAMP sem fuso, gravadas em UTC pelo Prisma). O cliente nunca compara
// com o relógio do PC (ADR-0004 §8.1) e a Node nunca decide se uma lease venceu.
const NOW = Prisma.raw("(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')");

const err = (status: number, code: string, message: string) => new CodedError(status, code, message);

export type ClaimedJob = { id: string; kind: PrintKind; attempt: number; leaseSeconds: number; ticket: PrintableOrder };
export type AckInput = { status: "PRINTED" | "FAILED"; code?: unknown; error?: unknown };

type ClaimRow = { id: string; kind: PrintKind; orderId: string | null; attempts: number; reprintNumber: number | null; remaining: number };

// Fila de impressão (ADR-0004). O servidor decide, o cliente obedece: claim com lease, ack idempotente pelo dono,
// recuo por falha (availableAt). Toda mudança de estado é um UPDATE condicional (storeId sempre no WHERE: o cuid não
// é segredo).
export class PrintJobService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogger,
    private readonly publish: (storeId: string, message: WsServerMessage) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ───────────── Dispositivo: claim ─────────────
  async claim(storeId: string, tokenId: string): Promise<{ job: ClaimedJob | null }> {
    const taken = await this.db.$transaction(
      async (tx) => {
        // Serializa os claims do MESMO token (lock consultivo por transação): sem isto, duas chamadas simultâneas da
        // mesma impressora (ex.: retry depois de timeout) passam juntas pela checagem "já tenho um job?" e cada uma
        // pega um job diferente — um deles fica preso pela lease inteira sem ninguém imprimir. Tokens diferentes
        // continuam em paralelo (SKIP LOCKED abaixo).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"printjob:claim:" + tokenId}))`;

        // 1) Mesmo dono, lease ainda válida (resposta perdida, cliente reiniciou): devolve o MESMO job, sem gastar tentativa.
        const again = await tx.$queryRaw<ClaimRow[]>`
          SELECT "id", "kind", "orderId", "attempts", "reprintNumber",
                 GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("leaseUntil" - ${NOW})))::int) AS "remaining"
            FROM "PrintJob"
           WHERE "storeId" = ${storeId} AND "status" = 'CLAIMED' AND "claimedByTokenId" = ${tokenId} AND "leaseUntil" > ${NOW}
           ORDER BY "createdAt" ASC, "id" ASC LIMIT 1`;
        if (again[0]) return { row: again[0], remaining: again[0].remaining, dead: [] as string[] };

        // 2) Lease vencida e sem tentativas sobrando: falha DEFINITIVA (alerta ao painel), em vez de voltar à fila para sempre.
        const dead = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "PrintJob"
             SET "status" = 'FAILED', "leaseUntil" = NULL, "ackStatus" = NULL,
                 "lastErrorCode" = COALESCE("lastErrorCode", 'OTHER'), "updatedAt" = ${NOW}
           WHERE "storeId" = ${storeId} AND "status" = 'CLAIMED' AND "leaseUntil" <= ${NOW} AND "attempts" >= "maxAttempts"
          RETURNING "id"`;

        // 3) Próximo job: PENDING já liberado (availableAt) ou CLAIMED com lease vencida (outro dono caiu). Um único UPDATE
        //    com SKIP LOCKED: dois consumidores concorrentes nunca pegam o mesmo job.
        const lease = leaseSeconds();
        const claimed = await tx.$queryRaw<ClaimRow[]>`
          UPDATE "PrintJob"
             SET "status" = 'CLAIMED', "attempts" = "attempts" + 1, "claimedAt" = ${NOW},
                 "leaseUntil" = ${NOW} + make_interval(secs => ${lease}::double precision),
                 "claimedByTokenId" = ${tokenId}, "ackStatus" = NULL, "updatedAt" = ${NOW}
           WHERE "id" = (
                   SELECT "id" FROM "PrintJob"
                    WHERE "storeId" = ${storeId}
                      AND (("status" = 'PENDING' AND "availableAt" <= ${NOW})
                        OR ("status" = 'CLAIMED' AND "leaseUntil" <= ${NOW} AND "attempts" < "maxAttempts"))
                    ORDER BY "createdAt" ASC, "id" ASC
                    FOR UPDATE SKIP LOCKED LIMIT 1)
             AND "storeId" = ${storeId}
          RETURNING "id", "kind", "orderId", "attempts", "reprintNumber", ${lease}::int AS "remaining"`;
        return { row: claimed[0] ?? null, remaining: lease, dead: dead.map((d) => d.id) };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    for (const id of taken.dead) this.publish(storeId, { type: "print.job_failed", jobId: id });
    if (!taken.row) return { job: null };
    return { job: await this.toClaimed(storeId, taken.row, taken.remaining) };
  }

  private async toClaimed(storeId: string, row: ClaimRow, remaining: number): Promise<ClaimedJob> {
    const base = { id: row.id, kind: row.kind, attempt: row.attempts, leaseSeconds: remaining };
    if (row.kind === "TEST") return { ...base, ticket: buildTestTicket(row.id, this.now()) };
    if (!row.orderId) throw err(500, "PRINT_JOB_WITHOUT_ORDER", "job sem pedido");

    if (row.kind === "ORDER_CANCEL_NOTICE") {
      const original = await this.originalPrintedAt(storeId, row.orderId);
      const ticket = await buildPrintableOrder(row.orderId, { cancelNotice: true, printedAtOriginal: original });
      if (!ticket) throw err(404, "ORDER_NOT_FOUND", "pedido não encontrado");
      return { ...base, ticket };
    }
    const reprintCount = row.kind === "ORDER_REPRINT" ? (row.reprintNumber ?? 1) : 0;
    const original = row.kind === "ORDER_REPRINT" ? await this.originalPrintedAt(storeId, row.orderId) : null;
    const ticket = await buildPrintableOrder(row.orderId, { reprintCount, printedAtOriginal: original });
    if (!ticket) throw err(404, "ORDER_NOT_FOUND", "pedido não encontrado");
    return { ...base, ticket };
  }

  // Quando o tíquete ORIGINAL saiu (para "1ª impressão: …" na 2ª via e no aviso de cancelamento).
  private async originalPrintedAt(storeId: string, orderId: string): Promise<Date | null> {
    const first = await this.db.printJob.findFirst({
      where: { storeId, orderId, kind: "ORDER_KITCHEN", status: "PRINTED" },
      select: { printedAt: true },
    });
    return first?.printedAt ?? null;
  }

  // ───────────── Dispositivo: ack ─────────────
  async ack(storeId: string, tokenId: string, jobId: string, input: AckInput): Promise<{ ok: true }> {
    if (input.status === "PRINTED") {
      const done = await this.db.$queryRaw<{ id: string; kind: PrintKind; orderId: string | null }[]>`
        UPDATE "PrintJob"
           SET "status" = 'PRINTED', "printedAt" = ${NOW}, "leaseUntil" = NULL, "ackStatus" = 'PRINTED',
               "lastErrorCode" = NULL, "lastError" = NULL, "updatedAt" = ${NOW}
         WHERE "id" = ${jobId} AND "storeId" = ${storeId} AND "claimedByTokenId" = ${tokenId}
           AND "status" = 'CLAIMED' AND "leaseUntil" > ${NOW}
        RETURNING "id", "kind", "orderId"`;
      if (done[0]) {
        // Compatibilidade com o endpoint legado (`printedAt` do pedido): só o tíquete original conta.
        if (done[0].kind === "ORDER_KITCHEN" && done[0].orderId) {
          await this.db.order.updateMany({ where: { id: done[0].orderId, storeId, printedAt: null }, data: { printedAt: this.now() } });
        }
        return { ok: true };
      }
      return this.ackRejected(storeId, tokenId, jobId, "PRINTED");
    }

    // FAILED: o código vem de lista fechada; `error` é NÃO confiável (sanitizado, só para auditoria interna).
    const code = normalizeFailureCode(input.code);
    const text = sanitizeDeviceText(input.error);
    const [b1, b2, b3] = BACKOFF_SECONDS;
    const failed = await this.db.$queryRaw<{ id: string; status: PrintJobStatus }[]>`
      UPDATE "PrintJob"
         SET "status" = CASE WHEN "attempts" < "maxAttempts" THEN 'PENDING'::"PrintJobStatus" ELSE 'FAILED'::"PrintJobStatus" END,
             "availableAt" = ${NOW} + make_interval(secs => (CASE "attempts" WHEN 1 THEN ${b1}::int WHEN 2 THEN ${b2}::int ELSE ${b3}::int END)::double precision),
             "leaseUntil" = NULL, "ackStatus" = 'FAILED', "lastErrorCode" = ${code}, "lastError" = ${text}, "updatedAt" = ${NOW}
       WHERE "id" = ${jobId} AND "storeId" = ${storeId} AND "claimedByTokenId" = ${tokenId}
         AND "status" = 'CLAIMED' AND "leaseUntil" > ${NOW}
      RETURNING "id", "status"`;
    if (failed[0]) {
      if (failed[0].status === "FAILED") this.publish(storeId, { type: "print.job_failed", jobId });
      return { ok: true };
    }
    return this.ackRejected(storeId, tokenId, jobId, "FAILED");
  }

  // Ack que não casou com o UPDATE condicional: 404 (não existe nesta loja), 200 idempotente (o mesmo dono repetindo
  // o que já valeu) ou 409 (lease vencida / outro dono). O cliente descarta o 409 e NÃO reimprime ("pelo menos uma vez").
  private async ackRejected(storeId: string, tokenId: string, jobId: string, requested: "PRINTED" | "FAILED"): Promise<{ ok: true }> {
    const job = await this.db.printJob.findFirst({ where: { id: jobId, storeId } });
    if (!job) throw err(404, "PRINT_JOB_NOT_FOUND", "job não encontrado"); // idêntico para inexistente e de outra loja

    const sameOwner = job.claimedByTokenId === tokenId;
    if (sameOwner && job.ackStatus === requested && (job.status === "PRINTED" || job.status === "PENDING" || job.status === "FAILED")) {
      return { ok: true }; // repetido pelo dono: 200 idempotente, sem efeito
    }
    if (sameOwner && job.status === "CLAIMED") {
      // Lease vencida: devolve o job à fila agora (ou FAILED se não há tentativas) em vez de esperar o próximo claim.
      await this.db.$executeRaw`
        UPDATE "PrintJob"
           SET "status" = CASE WHEN "attempts" < "maxAttempts" THEN 'PENDING'::"PrintJobStatus" ELSE 'FAILED'::"PrintJobStatus" END,
               "leaseUntil" = NULL, "updatedAt" = ${NOW}
         WHERE "id" = ${jobId} AND "storeId" = ${storeId} AND "status" = 'CLAIMED' AND "leaseUntil" <= ${NOW}`;
    }
    throw err(409, "PRINT_LEASE_LOST", "A impressão deste job não está mais com esta impressora.");
  }

  // ───────────── Painel ─────────────
  async reprint(actor: { storeId: string; userId: string }, orderId: string) {
    const created = await this.db.$transaction(
      async (tx) => {
        // Trava a linha do pedido: dois cliques simultâneos numeram 2ª via 1 e 2, nunca duas "1".
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} AND "storeId" = ${actor.storeId} FOR UPDATE`;
        const order = await tx.order.findFirst({ where: { id: orderId, storeId: actor.storeId }, select: { id: true, status: true, awaitingPayment: true } });
        if (!order) throw err(404, "ORDER_NOT_FOUND", "pedido não encontrado");
        if (order.status === "CANCELADO") throw err(409, "ORDER_CANCELED", "Pedido cancelado: não há o que reimprimir.");
        if (order.awaitingPayment) throw err(409, "ORDER_AWAITING_PAYMENT", "Pedido aguardando pagamento: ainda não foi para a cozinha.");
        const count = await tx.printJob.count({ where: { storeId: actor.storeId, orderId, kind: "ORDER_REPRINT" } });
        if (count >= MAX_REPRINTS_PER_ORDER) throw err(409, "REPRINT_LIMIT", "Limite de reimpressões deste pedido atingido.");
        return tx.printJob.create({
          data: { storeId: actor.storeId, orderId, kind: "ORDER_REPRINT", reprintNumber: count + 1, maxAttempts: DEFAULT_MAX_ATTEMPTS, requestedByUserId: actor.userId },
        });
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
    this.audit.log({
      storeId: actor.storeId,
      userId: actor.userId,
      action: "print.reprint",
      targetType: "Order",
      targetId: orderId,
      metadata: { jobId: created.id, reprintNumber: created.reprintNumber },
    });
    this.publish(actor.storeId, { type: "print.available" });
    return this.view(created);
  }

  async createTest(actor: { storeId: string; userId: string }) {
    const created = await this.db.printJob.create({
      data: { storeId: actor.storeId, kind: "TEST", maxAttempts: DEFAULT_MAX_ATTEMPTS, requestedByUserId: actor.userId },
    });
    this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "print.test", targetType: "PrintJob", targetId: created.id });
    this.publish(actor.storeId, { type: "print.available" });
    return this.view(created);
  }

  async list(storeId: string, query: { orderId?: string; limit?: number }) {
    const jobs = await this.db.printJob.findMany({
      where: { storeId, ...(query.orderId ? { orderId: query.orderId } : {}) },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
    });
    return jobs.map((job) => this.view(job));
  }

  // Resposta do painel por ALLOWLIST: nada do `lastError` recebido do cliente, nada do token da impressora.
  // O dono lê a frase traduzida do código.
  private view(job: PrintJob) {
    const code = job.lastErrorCode ? normalizeFailureCode(job.lastErrorCode) : null;
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      orderId: job.orderId,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      reprintNumber: job.reprintNumber,
      availableAt: job.availableAt,
      printedAt: job.printedAt,
      createdAt: job.createdAt,
      failure: code ? { code: code as FailureCode, message: FAILURE_MESSAGES[code] } : null,
    };
  }
}
