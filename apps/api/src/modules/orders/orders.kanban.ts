import { Prisma, type prisma as prismaClient } from "@meucardapio/db";
import { FINAL_STATUSES } from "../../lib/orderStateMachine";
import { decodeCursor, encodeCursor } from "./orders.history";

type Db = typeof prismaClient;

// Kanban: teto de abertos ANTIGOS (criados antes de hoje). Os mais novos nunca somem da cozinha; os escondidos são os
// mais velhos e o painel avisa (`openCapped`/`openHidden`) e leva ao Histórico › Em aberto (Leonardo, API-70).
export const KANBAN_OLD_OPEN_CAP = 500;
// Abertos de HOJE entram sempre; o teto duro só protege contra um loop/bug que crie pedido sem parar.
export const KANBAN_TODAY_OPEN_HARD_CAP = 1500;

// Os status finais entram no SQL como LITERAIS (constantes do código, nunca dado do usuário): comparar a coluna enum com
// literais mantém o índice (status, createdAt) utilizável; `status::text IN (...)` o desligava.
const FINAL_SQL = Prisma.raw(FINAL_STATUSES.map((status) => `'${status}'`).join(", "));

/**
 * Ids dos encerrados do dia (mais recente primeiro), com cursor por (instante do encerramento, id).
 *
 * Quando o pedido ENCERROU: o último registro de encerramento do histórico (a verdade). Pedido legado, sem nenhum registro de
 * encerramento, vale pela CRIAÇÃO (não há outra data confiável): `updatedAt` mexe com observação, reimpressão e entregador e
 * fazia pedido antigo voltar ao "hoje" (QA-28 H1).
 *
 * O custo acompanha o DIA, não o histórico da loja (API-71): a consulta parte dos registros de encerramento de hoje (índice
 * em OrderStatusHistory(status, createdAt)) e, para o legado, dos pedidos criados hoje (índice em Order(storeId, createdAt)).
 */
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
        return Prisma.sql`WHERE ("closedAt", "id") < (${new Date(c.t)}, ${c.id})`;
      })()
    : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string; closedAt: Date }[]>(Prisma.sql`
    SELECT "id", "closedAt" FROM (
      SELECT o."id", max(h."createdAt") AS "closedAt"
      FROM "OrderStatusHistory" h
      JOIN "Order" o ON o."id" = h."orderId"
      WHERE h."status" IN (${FINAL_SQL}) AND h."createdAt" >= ${todayStart}
        AND o."storeId" = ${storeId} AND o."awaitingPayment" = false AND o."status" IN (${FINAL_SQL})
      GROUP BY o."id"
      UNION ALL
      SELECT o."id", o."createdAt" AS "closedAt"
      FROM "Order" o
      WHERE o."storeId" = ${storeId} AND o."awaitingPayment" = false AND o."status" IN (${FINAL_SQL}) AND o."createdAt" >= ${todayStart}
        AND NOT EXISTS (SELECT 1 FROM "OrderStatusHistory" h WHERE h."orderId" = o."id" AND h."status" IN (${FINAL_SQL}))
    ) closed
    ${keyset}
    ORDER BY "closedAt" DESC, "id" DESC
    LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { ids: page.map((r) => r.id), nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.closedAt, id: last.id }) : null };
}
