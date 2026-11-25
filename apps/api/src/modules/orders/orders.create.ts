import type { OrderSource, Prisma, prisma as prismaClient } from "@meucardapio/db";
import type { WsServerMessage } from "@meucardapio/shared-types";
import { nextOrderCode, ORDER_TX_OPTIONS } from "../../lib/order-code";
import { optionCopiesCreate, orderItemExtras, type OrderLine } from "../../lib/orderItems";
import { enqueueOrderTicket } from "../printJobs/printJobs.queue";
import { deductStockForOrder, type StockAlert } from "../../lib/stock";

// D12: UMA criação de pedido para vitrine, mesa e balcão. As rotas só validam e traduzem HTTP; aqui ficam a transação
// (cupom, número, pedido, itens, tíquete) e os eventos depois do commit.
export type OrderOrigin = "STOREFRONT" | "TABLE" | "MANUAL"; // WHATSAPP entra junto da migração do enum OrderSource

const SOURCE_BY_ORIGIN: Record<OrderOrigin, OrderSource> = { STOREFRONT: "CLIENTE", TABLE: "QR_MESA", MANUAL: "PAINEL" };

export type OrderFields = Omit<Prisma.OrderUncheckedCreateInput, "id" | "storeId" | "code" | "source" | "items">;

export type CreateOrderCommand = {
  origin: OrderOrigin;
  storeId: string;
  items: readonly OrderLine[];
  /** Campos do pedido já validados e cotados pela rota. Recebe o número, que só existe dentro da transação. */
  fields: (code: string) => OrderFields;
  /** Conferências que precisam travar linhas ANTES do cupom e do número (ex.: caixa aberto). */
  precondition?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** FUNC-01: reserva do uso na mesma transação. `ignoreLimit` = o dono forçou um cupom esgotado (RN-B2-05). */
  coupon?: { id: string; ignoreLimit: boolean; exhaustedError: () => Error } | null;
  /** false = ainda aguarda pagamento: sem tíquete e sem eventos agora. */
  release: boolean;
  /** Roda depois do commit e ANTES dos eventos. */
  afterCommit?: (order: { id: string; code: string }) => void;
};

export async function createOrder(db: typeof prismaClient, publish: (storeId: string, message: WsServerMessage) => void, command: CreateOrderCommand) {
  const { storeId, coupon, release } = command;
  let ticketQueued = false;
  let stockAlerts: StockAlert[] = [];
  // Código e pedido na MESMA transação: o contador da loja fica travado até o commit (B01).
  const order = await db.$transaction(async (tx) => {
    await command.precondition?.(tx);
    // UPDATE condicional (usedCount < maxUses): sem vaga => 0 linhas => recusa ANTES de gastar número; rollback desfaz pedido e uso juntos.
    if (coupon) {
      const reserved = coupon.ignoreLimit
        ? await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = "usedCount" + 1 WHERE "id" = ${coupon.id} AND "storeId" = ${storeId} AND "active" = true`
        : await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = "usedCount" + 1 WHERE "id" = ${coupon.id} AND "storeId" = ${storeId} AND "active" = true AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
      if (reserved === 0) throw coupon.exhaustedError();
    }
    const code = await nextOrderCode(tx, storeId);
    const created = await tx.order.create({
      data: {
        ...command.fields(code),
        storeId,
        code,
        source: SOURCE_BY_ORIGIN[command.origin],
        items: {
          create: command.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            notes: item.notes,
            additionals: { create: item.additionals.map((a) => ({ name: a.name, priceCents: a.priceCents, additionalId: a.id ?? null })) },
            // Cópia da escolha no pedido (RN-B8-07): mudar o cardápio depois não altera pedido antigo.
            ...optionCopiesCreate(item.optionCopies),
            ...orderItemExtras(item),
          })),
        },
      } as Prisma.OrderUncheckedCreateInput,
    });
    // ESTOQUE: pedido que já nasce ACEITO (balcão do painel, QR sem aceite) dá baixa na mesma transação.
    if (created.status !== "PENDENTE" && created.status !== "CANCELADO") stockAlerts = (await deductStockForOrder(tx, { id: created.id, storeId }, new Date()))?.alerts ?? [];
    // Imprime AO CHEGAR; o tíquete nasce na MESMA transação (nunca pedido sem job).
    if (release) ticketQueued = await enqueueOrderTicket(tx, { id: created.id, storeId });
    return created;
  }, ORDER_TX_OPTIONS);

  command.afterCommit?.(order);
  if (release) {
    publish(storeId, { type: "order.created", orderId: order.id });
    if (ticketQueued) publish(storeId, { type: "print.available" });
  }
  for (const alert of stockAlerts) publish(storeId, { type: "stock.low", ...alert });
  return order;
}
