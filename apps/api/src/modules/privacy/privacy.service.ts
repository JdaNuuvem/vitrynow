import { Prisma, type prisma as prismaClient } from "@meucardapio/db";
import type { AnonymizeCustomerInput } from "@meucardapio/shared-types";
import { CodedError } from "../../shared/errors";
import { ORDER_TX_OPTIONS } from "../../lib/order-code";
import { utc } from "../../lib/sqlTime";
import { FINAL_STATUSES } from "../../lib/orderStateMachine";
import { maskPhone } from "../orders/orders.view";

type Db = typeof prismaClient;

// LGPD (ADR-0014 §3.1, spec do Leonardo RN-PV-01..10): ANONIMIZAR, não destruir. Zera nome, telefone, endereço, observações do cliente
// e a observação interna; FICAM código, data, tipo, itens, valores, desconto, taxa, gorjeta, forma de pagamento, status e histórico,
// então caixa e relatórios continuam fechando. Só pedido ENCERRADO; irreversível.
export type PrivacyActor = { storeId: string; userId: string; role: "OWNER" | "STAFF" };
export type AnonymizeTarget = { phone?: string; orderCode?: string };

type Match = { id: string; code: string; status: string; awaitingPayment: boolean; refundLockedAt: Date | null; paymentStatus: string | null; createdAt: Date; hasData: boolean };

const FINAL = new Set<string>(FINAL_STATUSES);
const err = (status: number, code: string, message: string, extra?: Record<string, unknown>) => new CodedError(status, code, message, extra);

/** Só os dígitos; "55" na frente (12 ou 13 dígitos) é código do país e sai, como na busca do histórico (RN-HP-01). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return (digits.length === 12 || digits.length === 13) && digits.startsWith("55") ? digits.slice(2) : digits;
}

export class PrivacyService {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  private async find(tx: Pick<Db, "$queryRaw">, storeId: string, target: AnonymizeTarget, lock: boolean): Promise<Match[]> {
    let where: Prisma.Sql;
    if (target.phone) {
      const digits = normalizePhone(target.phone);
      if (digits.length < 8) throw err(400, "PHONE_INVALID", "Telefone inválido.");
      where = Prisma.sql`regexp_replace(coalesce(o."customerPhone", ''), '\\D', '', 'g') IN (${digits}, ${"55" + digits})`;
    } else if (target.orderCode) {
      const code = target.orderCode.trim();
      where = Prisma.sql`(o."code" = ${code} OR (${code}::text ~ '^[0-9]+$' AND ltrim(o."code", '0') = ltrim(${code}, '0')))`;
    } else {
      throw err(400, "TARGET_REQUIRED", "Informe o telefone ou o código do pedido.");
    }
    // Pedido já anonimizado não entra (a segunda chamada é inofensiva). O lock impede que o pedido mude de estado no meio.
    const rows = await tx.$queryRaw<Array<{ id: string; code: string; status: string; awaitingPayment: boolean; refundLockedAt: Date | null; paymentStatus: string | null; createdAt: Date; hasData: boolean }>>(Prisma.sql`
      SELECT o."id", o."code", o."status"::text AS "status", o."awaitingPayment", o."refundLockedAt", p."status"::text AS "paymentStatus", o."createdAt",
        (o."customerName" IS NOT NULL OR o."customerPhone" IS NOT NULL OR o."address" IS NOT NULL OR o."notes" IS NOT NULL OR o."internalNote" IS NOT NULL
          OR EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = o."id" AND i."notes" IS NOT NULL)) AS "hasData"
      FROM "Order" o LEFT JOIN "Payment" p ON p."orderId" = o."id"
      WHERE o."storeId" = ${storeId} AND o."anonymizedAt" IS NULL AND ${where}
      ORDER BY o."createdAt", o."id"
      ${lock ? Prisma.sql`FOR UPDATE OF o` : Prisma.empty}`);
    return rows;
  }

  /** O que impede de anonimizar agora: pedido em aberto, PIX ainda não pago ou estorno em curso (RN-PV-04). Códigos de pedido não são dado pessoal. */
  private blockers(matches: Match[]) {
    return matches
      .filter((m) => !FINAL.has(m.status) || m.awaitingPayment || m.refundLockedAt !== null || m.paymentStatus === "ESTORNO_PENDENTE")
      .map((m) => ({ code: m.code, status: m.status, reason: m.paymentStatus === "ESTORNO_PENDENTE" || m.refundLockedAt ? "REFUND_PENDING" : "OPEN" }));
  }

  /** Prévia (RN-PV-02): quantos pedidos, o período e o que bloqueia. Não devolve nome, telefone nem endereço. */
  async preview(actor: PrivacyActor, target: AnonymizeTarget) {
    this.assertOwner(actor);
    const matches = await this.find(this.db, actor.storeId, target, false);
    const withData = matches.filter((m) => m.hasData);
    const blockers = this.blockers(matches);
    return {
      orders: withData.length,
      period: withData.length ? { from: withData[0].createdAt.toISOString(), to: withData[withData.length - 1].createdAt.toISOString() } : null,
      phoneMasked: target.phone ? maskPhone(normalizePhone(target.phone)) : null,
      blocked: blockers.length > 0,
      blockers,
      // RN-PV-07: achou o pedido, mas não há nada pessoal nele (teste, mesa sem telefone, ou já anonimizado).
      nothingToRemove: matches.length > 0 && withData.length === 0,
    };
  }

  /** Executa (RN-PV-01..03): atômico com a auditoria. A confirmação repete o efeito (`expectedOrders`). */
  async anonymize(actor: PrivacyActor, input: AnonymizeCustomerInput) {
    this.assertOwner(actor);
    const target: AnonymizeTarget = { phone: input.phone, orderCode: input.orderCode };
    return this.db.$transaction(async (tx) => {
      const matches = await this.find(tx as unknown as Db, actor.storeId, target, true);
      const blockers = this.blockers(matches);
      if (blockers.length) throw err(409, "OPEN_ORDERS", `Este cliente tem ${blockers.length} pedido(s) em andamento. Conclua ou cancele antes.`, { orders: blockers });
      const withData = matches.filter((m) => m.hasData);
      if (withData.length === 0) return { anonymized: 0, nothingToRemove: true as const }; // RN-PV-07: nada a remover (ou já anonimizado); nada é gravado
      if (withData.length !== input.expectedOrders) throw err(409, "COUNT_CHANGED", "O número de pedidos mudou desde a prévia. Confira e confirme de novo.", { orders: withData.length });

      const ids = withData.map((m) => m.id);
      // SQL direto de propósito: anonimizar não é atividade do pedido e não pode mexer em `updatedAt`.
      await tx.$executeRaw`UPDATE "Order" SET "customerName" = NULL, "customerPhone" = NULL, "address" = NULL, "notes" = NULL, "internalNote" = NULL, "anonymizedAt" = ${utc(this.now())} WHERE "storeId" = ${actor.storeId} AND "id" IN (${Prisma.join(ids)})`;
      await tx.orderItem.updateMany({ where: { orderId: { in: ids } }, data: { notes: null } });
      // Auditoria na MESMA transação: ou apaga e registra, ou nada. Sem o dado removido (nem telefone, nem nome): só quantidade, período e motivo.
      await tx.auditLog.create({
        data: {
          storeId: actor.storeId,
          userId: actor.userId,
          action: "privacy.anonymize_customer",
          targetType: "Store",
          targetId: actor.storeId,
          metadata: { orders: ids.length, by: input.phone ? "PHONE" : "ORDER_CODE", reason: input.reason, from: withData[0].createdAt.toISOString(), to: withData[withData.length - 1].createdAt.toISOString() },
        },
      });
      return { anonymized: ids.length, nothingToRemove: false as const };
    }, ORDER_TX_OPTIONS);
  }

  private assertOwner(actor: PrivacyActor) {
    if (actor.role !== "OWNER") throw err(403, "FORBIDDEN_ROLE", "Só o dono da loja pode fazer isso.");
  }
}
