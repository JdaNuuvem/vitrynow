import { Prisma, type prisma as prismaClient, type PrintJob, type PrintKind, type PrintJobStatus, type PrintMode } from "@meucardapio/db";
import type { PanelRole } from "@meucardapio/shared-types";
import { NOW_UTC } from "../../lib/sqlTime";
import type { PrintableOrder, WsServerMessage } from "@meucardapio/shared-types";
import { CodedError } from "../../shared/errors";
import type { AuditLogger } from "../../shared/audit";
import { authorizeContactView } from "../orders/contactAccess";
import { loadPrintMode } from "./printMode.service";
import { lockPrintMode } from "./printJobs.queue";
import { buildPrintableOrder, buildTestTicket } from "../../lib/printable";
import {
  BACKOFF_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
  FAILURE_MESSAGES,
  MAX_REPRINTS_PER_ORDER,
  leaseSeconds,
  staleWindowSeconds,
  normalizeFailureCode,
  sanitizeDeviceText,
  type FailureCode,
} from "../../lib/printJobs";

type Db = typeof prismaClient;

// Relógio do BANCO em UTC (as colunas são TIMESTAMP sem fuso, gravadas em UTC pelo Prisma). O cliente nunca compara
// com o relógio do PC (ADR-0004 §8.1) e a Node nunca decide se uma lease venceu.
const NOW = NOW_UTC; // relógio do banco em UTC (lib/sqlTime)

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
    // Eventos print.* do PAINEL (N8): a impressora não os recebe. Por padrão usa o mesmo publicador (testes unitários).
    private readonly publishPanel: (storeId: string, message: WsServerMessage) => void = publish,
  ) {}

  // N6 (RN-IMP-20): o que passou da janela de retomada (12 h; vale desde a criação ou desde o "Imprimir agora") vira STALE e NÃO é entregue.
  // Roda DENTRO de uma transação que já tomou o lock da loja. Devolve quantos jobs mudaram (para o aviso ao painel).
  private async sweepStale(tx: Pick<Prisma.TransactionClient, "$queryRaw">, storeId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "PrintJob"
         SET "status" = 'STALE', "leaseUntil" = NULL, "updatedAt" = ${NOW}
       WHERE "storeId" = ${storeId}
         AND ("status" = 'PENDING' OR ("status" = 'CLAIMED' AND "leaseUntil" <= ${NOW}))
         AND COALESCE("resumedAt", "createdAt") < ${NOW} - make_interval(secs => ${staleWindowSeconds()}::double precision)
      RETURNING "id"`;
    return rows.length;
  }

  // ───────────── Dispositivo: claim ─────────────
  async claim(storeId: string, tokenId: string): Promise<{ job: ClaimedJob | null; mode: PrintMode }> {
    // O modo é do SERVIDOR (ADR-0004 §8.12). Em LEGACY o claim não entrega nada: quem imprime é o caminho legado, nunca os dois.
    const mode = await loadPrintMode(this.db, storeId);
    if (mode === "LEGACY") return { job: null, mode };
    const taken = await this.db.$transaction(
      async (tx) => {
        // Serializa com a TROCA DE MODO (item 14 do ADR): o claim segura o lock consultivo da loja em modo COMPARTILHADO (claims não se
        // bloqueiam entre si) e a troca o pede em modo exclusivo. Assim, ou o claim termina antes (e o recuo vê o job CLAIMED e recusa
        // com PRINT_IN_PROGRESS), ou a troca termina antes (e o claim relê o modo aqui dentro e não entrega nada em LEGACY).
        await lockPrintMode(tx, storeId);
        const modeNow = await loadPrintMode(tx, storeId);
        if (modeNow === "LEGACY") return { row: null as ClaimRow | null, remaining: 0, dead: [] as { id: string; code: string | null }[], mode: modeNow, staled: 0 };

        // N6: antes de qualquer entrega, o que passou da janela de 12 h sai da fila (STALE). Em seguida o claim só enxerga o que está dentro dela.
        const staled = await this.sweepStale(tx, storeId);

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
        if (again[0]) return { row: again[0] as ClaimRow | null, remaining: again[0].remaining, dead: [] as { id: string; code: string | null }[], mode: modeNow, staled };

        // 2) Lease vencida e sem tentativas sobrando: falha DEFINITIVA (alerta ao painel), em vez de voltar à fila para sempre.
        const dead = await tx.$queryRaw<{ id: string; lastErrorCode: string | null }[]>`
          UPDATE "PrintJob"
             SET "status" = 'FAILED', "leaseUntil" = NULL, "ackStatus" = NULL,
                 "lastErrorCode" = COALESCE("lastErrorCode", 'OTHER'), "updatedAt" = ${NOW}
           WHERE "storeId" = ${storeId} AND "status" = 'CLAIMED' AND "leaseUntil" <= ${NOW} AND "attempts" >= "maxAttempts"
          RETURNING "id", "lastErrorCode"`;

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
        return { row: (claimed[0] ?? null) as ClaimRow | null, remaining: lease, dead: dead.map((d) => ({ id: d.id, code: d.lastErrorCode })), mode: modeNow, staled };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    for (const d of taken.dead) this.publishPanel(storeId, { type: "print.job_failed", jobId: d.id, code: normalizeFailureCode(d.code) });
    if (taken.staled > 0) this.publishPanel(storeId, { type: "print.stale", count: taken.staled });
    if (!taken.row) return { job: null, mode: taken.mode };
    this.publishPanel(storeId, { type: "print.claimed", jobId: taken.row.id });
    return { job: await this.toClaimed(storeId, taken.row, taken.remaining), mode: taken.mode };
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
      // O job e o `printedAt` do pedido mudam NA MESMA transação (R2 do Deming: antes eram 2 comandos e uma falha entre eles
      // deixava o job PRINTED com o pedido "não impresso" — o legado o reimprimiria no recuo).
      const done = await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; kind: PrintKind; orderId: string | null }[]>`
          UPDATE "PrintJob"
             SET "status" = 'PRINTED', "printedAt" = ${NOW}, "leaseUntil" = NULL, "ackStatus" = 'PRINTED',
                 "lastErrorCode" = NULL, "lastError" = NULL, "updatedAt" = ${NOW}
           WHERE "id" = ${jobId} AND "storeId" = ${storeId} AND "claimedByTokenId" = ${tokenId}
             AND "status" = 'CLAIMED' AND "leaseUntil" > ${NOW}
          RETURNING "id", "kind", "orderId"`;
        const row = rows[0];
        if (!row) return null;
        // Compatibilidade com o endpoint legado (`printedAt` do pedido): só o tíquete original conta.
        if (row.kind === "ORDER_KITCHEN" && row.orderId) {
          await tx.order.updateMany({ where: { id: row.orderId, storeId, printedAt: null }, data: { printedAt: this.now() } });
        }
        return row;
      });
      if (done) {
        this.publishPanel(storeId, { type: "print.printed", jobId: done.id, ...(done.orderId ? { orderId: done.orderId } : {}) });
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
      if (failed[0].status === "FAILED") this.publishPanel(storeId, { type: "print.job_failed", jobId, code });
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
      // repetido pelo dono: 200 idempotente. Se o `printedAt` do pedido ficou para trás, conserta (nunca desfaz nada).
      if (requested === "PRINTED" && job.kind === "ORDER_KITCHEN" && job.orderId) {
        await this.db.order.updateMany({ where: { id: job.orderId, storeId, printedAt: null }, data: { printedAt: job.printedAt ?? this.now() } });
      }
      return { ok: true };
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
  async reprint(actor: { storeId: string; userId: string; role: PanelRole }, orderId: string) {
    await this.requireQueueMode(actor.storeId);
    // A 2ª via sai com telefone e endereço COMPLETOS: é uma DIVULGAÇÃO de contato e segue a regra única do detalhe
    // (authorizeContactView): papel e idade (STAFF só pedido aberto ou encerrado há < 24 h), rastro `order.view_contact`
    // gravado de forma ESTRITA antes de o tíquete existir e falha fechada se o rastro não puder ser gravado.
    const found = await this.db.order.findFirst({
      where: { id: orderId, storeId: actor.storeId },
      select: { id: true, status: true, awaitingPayment: true, customerPhone: true, address: true },
    });
    if (!found) throw err(404, "ORDER_NOT_FOUND", "pedido não encontrado");
    // Recusas por estado ANTES do rastro de contato: não se registra acesso a contato que nem vai ser entregue (R-1, Nightingale).
    if (found.status === "CANCELADO") throw err(409, "ORDER_CANCELED", "Pedido cancelado: não há o que reimprimir.");
    if (found.awaitingPayment) throw err(409, "ORDER_AWAITING_PAYMENT", "Pedido aguardando pagamento: ainda não foi para a cozinha.");
    const closing = await this.db.orderStatusHistory.findFirst({ where: { orderId }, orderBy: { seq: "desc" }, select: { createdAt: true } });
    const decision = await authorizeContactView({ db: this.db, audit: this.audit, now: this.now }, actor, found, closing?.createdAt ?? null);
    if (decision.unavailable) {
      throw err(503, "CONTACT_AUDIT_UNAVAILABLE", "Não foi possível registrar o acesso ao contato do cliente. Tente de novo.");
    }
    if (decision.access === "MASKED") throw err(403, "FORBIDDEN_ROLE", "Só o dono pode reimprimir um pedido antigo.");

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

  // N6 "Imprimir agora": devolve à fila um job STALE (passou da janela de 12 h). Mesma regra de divulgação de contato da 2ª via; ordem de
  // travas lockPrintMode (compartilhado) → pedido → PrintJob; a transição é um UPDATE condicional (dois cliques = 1 efeito).
  async printNow(actor: { storeId: string; userId: string; role: PanelRole }, jobId: string) {
    await this.requireQueueMode(actor.storeId);
    const job = await this.db.printJob.findFirst({ where: { id: jobId, storeId: actor.storeId }, select: { id: true, kind: true, orderId: true } });
    if (!job) throw err(404, "PRINT_JOB_NOT_FOUND", "job não encontrado"); // idêntico para inexistente e de outra loja
    if (job.orderId) {
      const found = await this.db.order.findFirst({
        where: { id: job.orderId, storeId: actor.storeId },
        select: { id: true, status: true, customerPhone: true, address: true },
      });
      if (!found) throw err(404, "PRINT_JOB_NOT_FOUND", "job não encontrado");
      if (found.status === "CANCELADO" && job.kind !== "ORDER_CANCEL_NOTICE") throw err(409, "ORDER_CANCELED", "Pedido cancelado: não há o que imprimir.");
      const closing = await this.db.orderStatusHistory.findFirst({ where: { orderId: job.orderId }, orderBy: { seq: "desc" }, select: { createdAt: true } });
      const decision = await authorizeContactView({ db: this.db, audit: this.audit, now: this.now }, actor, found, closing?.createdAt ?? null);
      if (decision.unavailable) throw err(503, "CONTACT_AUDIT_UNAVAILABLE", "Não foi possível registrar o acesso ao contato do cliente. Tente de novo.");
      if (decision.access === "MASKED") throw err(403, "FORBIDDEN_ROLE", "Só o dono pode imprimir agora um pedido antigo.");
    }
    const moved = await this.db.$transaction(
      async (tx) => {
        await lockPrintMode(tx, actor.storeId);
        if (job.orderId) {
          const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS "status" FROM "Order" WHERE "id" = ${job.orderId} AND "storeId" = ${actor.storeId} FOR UPDATE`;
          if (!row) throw err(404, "PRINT_JOB_NOT_FOUND", "job não encontrado");
          if (row.status === "CANCELADO" && job.kind !== "ORDER_CANCEL_NOTICE") throw err(409, "ORDER_CANCELED", "Pedido cancelado: não há o que imprimir.");
        }
        const rows = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "PrintJob"
             SET "status" = 'PENDING', "attempts" = 0, "availableAt" = ${NOW}, "resumedAt" = ${NOW}, "claimedByTokenId" = NULL, "leaseUntil" = NULL,
                 "ackStatus" = NULL, "lastErrorCode" = NULL, "lastError" = NULL, "updatedAt" = ${NOW}
           WHERE "id" = ${jobId} AND "storeId" = ${actor.storeId} AND "status" = 'STALE'
          RETURNING "id"`;
        return rows.length === 1;
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
    const current = await this.db.printJob.findFirstOrThrow({ where: { id: jobId, storeId: actor.storeId } });
    if (moved) {
      this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "print.print_now", targetType: "PrintJob", targetId: jobId });
      this.publish(actor.storeId, { type: "print.available" });
      return this.view(current);
    }
    // Não estava STALE: quem chegou antes já o devolveu à fila (ou ele já saiu) ⇒ idempotente; cancelado/falho definitivo não volta.
    if (current.status === "PENDING" || current.status === "CLAIMED" || current.status === "PRINTED") return this.view(current);
    throw err(409, "PRINT_JOB_NOT_STALE", "Este trabalho não está esperando para imprimir agora.");
  }

  // Resumo para o aviso do painel (RN-IMP-20: "{n} pedidos não saíram na impressora"). Varre a janela também sem impressora conectada.
  async summary(storeId: string): Promise<{ stale: number }> {
    let staled = 0;
    if ((await loadPrintMode(this.db, storeId)) === "QUEUE") {
      staled = await this.db.$transaction(async (tx) => {
        await lockPrintMode(tx, storeId);
        return this.sweepStale(tx, storeId);
      });
      if (staled > 0) this.publishPanel(storeId, { type: "print.stale", count: staled });
    }
    return { stale: await this.db.printJob.count({ where: { storeId, status: "STALE" } }) };
  }

  async createTest(actor: { storeId: string; userId: string }) {
    await this.requireQueueMode(actor.storeId);
    const created = await this.db.printJob.create({
      data: { storeId: actor.storeId, kind: "TEST", maxAttempts: DEFAULT_MAX_ATTEMPTS, requestedByUserId: actor.userId },
    });
    this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "print.test", targetType: "PrintJob", targetId: created.id });
    this.publish(actor.storeId, { type: "print.available" });
    return this.view(created);
  }

  // Reimpressão e teste de impressora geram jobs: com a loja em LEGACY ninguém os consome. Falha clara em vez de job parado.
  private async requireQueueMode(storeId: string) {
    if ((await loadPrintMode(this.db, storeId)) !== "QUEUE") {
      throw err(409, "PRINT_MODE_LEGACY", "A impressão por fila ainda não está ativa nesta loja. Peça ao dono para ativá-la.");
    }
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
