import type { Prisma } from "@meucardapio/db";
import { dedupeKeyFor, DEFAULT_MAX_ATTEMPTS } from "../../lib/printJobs";

// Operações da fila que acontecem DENTRO de outras transações (criar o pedido, aprovar o pagamento, cancelar).
// Recebem o cliente da transação, então o job nasce (ou é cancelado) junto do pedido: nunca pedido sem tíquete,
// nunca tíquete de pedido que não existe. Idempotentes por `dedupeKey` (1 job por pedido e tipo).

type Tx = Pick<Prisma.TransactionClient, "printJob">;

// Tíquete original do pedido (ORDER_KITCHEN). Devolve true se CRIOU (quem chama publica `print.available` depois do commit).
export async function enqueueOrderTicket(tx: Tx, order: { id: string; storeId: string }): Promise<boolean> {
  const created = await tx.printJob.createMany({
    data: [
      {
        storeId: order.storeId,
        orderId: order.id,
        kind: "ORDER_KITCHEN",
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        dedupeKey: dedupeKeyFor(order.id, "ORDER_KITCHEN"),
      },
    ],
    skipDuplicates: true,
  });
  return created.count === 1;
}

// Pedido cancelado: o que ainda NÃO começou a imprimir deixa de ser entregue (CANCELED). Roda na transação do cancelamento.
export async function cancelPendingTickets(tx: Tx, order: { id: string; storeId: string }): Promise<number> {
  const canceled = await tx.printJob.updateMany({
    where: { storeId: order.storeId, orderId: order.id, kind: { in: ["ORDER_KITCHEN", "ORDER_REPRINT"] }, status: "PENDING" },
    data: { status: "CANCELED" },
  });
  return canceled.count;
}

// Depois do commit do cancelamento: se algum tíquete do pedido já saiu (ou está saindo agora), manda o AVISO de
// cancelamento para a cozinha. Idempotente. Devolve true se criou o aviso.
export async function enqueueCancelNoticeIfPrinted(tx: Tx, order: { id: string; storeId: string }): Promise<boolean> {
  const out = await tx.printJob.findFirst({
    where: { storeId: order.storeId, orderId: order.id, kind: { in: ["ORDER_KITCHEN", "ORDER_REPRINT"] }, status: { in: ["PRINTED", "CLAIMED"] } },
    select: { id: true },
  });
  if (!out) return false;
  const created = await tx.printJob.createMany({
    data: [
      {
        storeId: order.storeId,
        orderId: order.id,
        kind: "ORDER_CANCEL_NOTICE",
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        dedupeKey: dedupeKeyFor(order.id, "ORDER_CANCEL_NOTICE"),
      },
    ],
    skipDuplicates: true,
  });
  return created.count === 1;
}
