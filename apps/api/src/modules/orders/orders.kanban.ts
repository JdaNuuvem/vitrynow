import { Prisma, type prisma as prismaClient } from "@meucardapio/db";
import { FINAL_STATUSES } from "../../lib/orderStateMachine";
import { decodeCursor, encodeCursor } from "./orders.history";

type Db = typeof prismaClient;

// Kanban: teto de abertos ANTIGOS (criados antes de hoje). Os mais novos nunca somem da cozinha; os escondidos são os
// mais velhos e o painel avisa (`openCapped`/`openHidden`) e leva ao Histórico › Em aberto (Leonardo, API-70).
export const KANBAN_OLD_OPEN_CAP = 500;
// Abertos de HOJE entram sempre; o teto duro só protege contra um loop/bug que crie pedido sem parar.
export const KANBAN_TODAY_OPEN_HARD_CAP = 1500;

/**
 * Quando o pedido ENCERROU: o último registro de encerramento do histórico (a verdade); sem registro (pedido legado) vale a
 * última alteração. Nunca `updatedAt` quando há histórico: gravar uma observação interna, imprimir ou atribuir entregador
 * mexe em `updatedAt` e não pode fazer pedido antigo voltar ao "hoje" (QA-28 H1) nem reordenar "Concluídos hoje".
 */
const CLOSED_AT = Prisma.sql`COALESCE((SELECT max(h."createdAt") FROM "OrderStatusHistory" h WHERE h."orderId" = o."id" AND h."status"::text IN (${Prisma.join([...FINAL_STATUSES])})), o."updatedAt")`;

/** Ids dos encerrados do dia (mais recente primeiro), com cursor por (instante do encerramento, id). */
export async function closedTodayIds(
  db: Db,
  storeId: string,
  todayStart: Date,
  limit: number,
  cursor?: string,
): Promise<{ ids: string[]; nextCursor: string | null }> {
  const keyset = cursor
    ? (() => {
        const c = decodeCursor(cursor);
        return Prisma.sql` AND (${CLOSED_AT}, o."id") < (${new Date(c.t)}, ${c.id})`;
      })()
    : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string; closedAt: Date }[]>(Prisma.sql`
    SELECT o."id", ${CLOSED_AT} AS "closedAt"
    FROM "Order" o
    WHERE o."storeId" = ${storeId} AND o."awaitingPayment" = false AND o."status"::text IN (${Prisma.join([...FINAL_STATUSES])})
      AND ${CLOSED_AT} >= ${todayStart}${keyset}
    ORDER BY ${CLOSED_AT} DESC, o."id" DESC
    LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { ids: page.map((r) => r.id), nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.closedAt, id: last.id }) : null };
}
