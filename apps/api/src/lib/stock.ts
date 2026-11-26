import { randomUUID } from "node:crypto";
import type { Prisma, StockMovementType } from "@meucardapio/db";
import { ORDER_CANCELED_WASTE_REASON } from "@meucardapio/shared-types";

// ESTOQUE E LUCRO — núcleo. Regras:
// - Saldo e custo em UNIDADE BASE inteira (g, ml, un); custo em milésimos de centavo por unidade (R$ 40,00/kg = 4000).
// - Custo médio PONDERADO: só entradas (compra e estorno de venda) mudam o custo; saídas saem pelo custo médio do momento.
// - Saldo pode ficar NEGATIVO (decisão: só alerta); com saldo <= 0, a próxima compra define o custo sozinha.
// - A venda dá baixa ao ACEITAR o pedido (sai de PENDENTE) e é estornada se o pedido aceito volta para PENDENTE (desfazer) ou é cancelado.
//   Idempotência: `Order.stockDeductedAt` (baixa só onde é nulo; estorno só onde não é) + estorno do SALDO LÍQUIDO do pedido.
// - Insumos travados em ordem de id (FOR UPDATE) para duas baixas simultâneas nunca se travarem mutuamente.

type Tx = Prisma.TransactionClient;
export const MILLI = 1000;

/** Valor em centavos (com sinal) de `quantity` unidades a `unitCostMillicents`. */
export const costCentsOf = (quantity: number, unitCostMillicents: number) => Math.round((quantity * unitCostMillicents) / MILLI);

/** Novo custo médio depois de uma ENTRADA de `inQty` a `inCost`. Saldo anterior <= 0 não pondera (não há estoque valorizado). */
export function weightedAverage(currentQty: number, currentCost: number, inQty: number, inCost: number): number {
  if (inQty <= 0) return currentCost;
  if (currentQty <= 0) return inCost;
  return Math.round((currentQty * currentCost + inQty * inCost) / (currentQty + inQty));
}

/** Custo unitário de uma compra: total pago ÷ quantidade, em milésimos de centavo. */
export const unitCostFromTotal = (totalCents: number, quantity: number) => (quantity > 0 ? Math.round((totalCents * MILLI) / quantity) : 0);

export type ConsumptionLine = {
  productId: string | null;
  quantity: number;
  weightGrams: number | null; // produto por peso: a ficha é por 1 kg
  options: { optionId: string | null; quantity: number }[];
};
export type Recipes = {
  product: Map<string, { ingredientId: string; quantity: number }[]>;
  option: Map<string, { ingredientId: string; quantity: number }[]>;
};

/** Quanto de cada insumo um conjunto de linhas consome (pura). Linha sem ficha não consome nada. */
export function consumptionOf(lines: ConsumptionLine[], recipes: Recipes): Map<string, number> {
  const total = new Map<string, number>();
  const add = (ingredientId: string, qty: number) => {
    if (qty > 0) total.set(ingredientId, (total.get(ingredientId) ?? 0) + qty);
  };
  for (const line of lines) {
    const factor = line.weightGrams !== null ? line.weightGrams / 1000 : line.quantity;
    for (const r of (line.productId && recipes.product.get(line.productId)) || []) add(r.ingredientId, Math.round(r.quantity * factor));
    // opção: por unidade do item × quantidade escolhida (peso não se aplica a opção)
    for (const o of line.options) {
      for (const r of (o.optionId && recipes.option.get(o.optionId)) || []) add(r.ingredientId, r.quantity * o.quantity * line.quantity);
    }
  }
  return total;
}

export type StockAlert = { ingredientId: string; kind: "LOW" | "NEGATIVE" };

type MovementInput = { storeId: string; ingredientId: string; type: StockMovementType; quantity: number; unitCostMillicents?: number; orderId?: string; reason?: string; userId?: string | null; note?: string; groupId?: string; reversalOfId?: string; expiresOn?: Date; now: Date };

/**
 * Aplica UMA movimentação com a linha do insumo já travada: grava a movimentação e atualiza saldo (e custo médio nas entradas).
 * Entradas com custo próprio (compra, estorno) ponderam; saídas usam o custo médio atual. Devolve a movimentação.
 */
export async function applyMovement(tx: Tx, input: MovementInput) {
  const rows = await tx.$queryRaw<{ stockQty: number; unitCostMillicents: number; minStockQty: number | null }[]>`
    SELECT "stockQty", "unitCostMillicents", "minStockQty" FROM "Ingredient" WHERE "id" = ${input.ingredientId} AND "storeId" = ${input.storeId} FOR UPDATE`;
  if (rows.length === 0) throw new Error("insumo não encontrado nesta loja");
  const { stockQty, unitCostMillicents: avg, minStockQty } = rows[0];
  const after = stockQty + input.quantity;
  // Alerta só no CRUZAMENTO (uma vez por descida): ficou negativo agora, ou passou do mínimo para baixo agora.
  const alert: StockAlert | null =
    after < 0 && stockQty >= 0 ? { ingredientId: input.ingredientId, kind: "NEGATIVE" }
    : minStockQty !== null && stockQty > minStockQty && after <= minStockQty ? { ingredientId: input.ingredientId, kind: "LOW" }
    : null;
  const inflow = input.quantity > 0;
  const unitCost = inflow && input.unitCostMillicents !== undefined ? input.unitCostMillicents : avg;
  const newCost = inflow && input.unitCostMillicents !== undefined ? weightedAverage(stockQty, avg, input.quantity, unitCost) : avg;
  await tx.ingredient.update({ where: { id: input.ingredientId }, data: { stockQty: after, unitCostMillicents: newCost } });
  const movement = await tx.stockMovement.create({
    data: {
      storeId: input.storeId,
      ingredientId: input.ingredientId,
      type: input.type,
      quantity: input.quantity,
      unitCostMillicents: unitCost,
      costCents: costCentsOf(input.quantity, unitCost),
      orderId: input.orderId ?? null,
      reason: input.reason ?? null,
      userId: input.userId ?? null,
      note: input.note ?? null,
      groupId: input.groupId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      expiresOn: input.expiresOn ?? null,
      createdAt: input.now,
    },
  });
  return Object.assign(movement, { alert });
}

async function loadRecipes(tx: Tx, storeId: string, productIds: string[], optionIds: string[]): Promise<Recipes> {
  const [products, options] = await Promise.all([
    productIds.length ? tx.recipeItem.findMany({ where: { storeId, productId: { in: productIds } }, select: { productId: true, ingredientId: true, quantity: true } }) : [],
    optionIds.length ? tx.optionRecipeItem.findMany({ where: { storeId, optionId: { in: optionIds } }, select: { optionId: true, ingredientId: true, quantity: true } }) : [],
  ]);
  const group = <K extends string>(rows: ({ [P in K]: string } & { ingredientId: string; quantity: number })[], key: K) => {
    const map = new Map<string, { ingredientId: string; quantity: number }[]>();
    for (const r of rows) map.set(r[key], [...(map.get(r[key]) ?? []), { ingredientId: r.ingredientId, quantity: r.quantity }]);
    return map;
  };
  return { product: group(products, "productId"), option: group(options, "optionId") };
}

/** Baixa da venda (dentro da transação que aceitou o pedido). Idempotente: só a primeira chamada por aceite tem efeito. Devolve o CMV. */
export async function deductStockForOrder(tx: Tx, order: { id: string; storeId: string }, now: Date): Promise<{ cogsCents: number; alerts: StockAlert[] } | null> {
  const claimed = await tx.order.updateMany({ where: { id: order.id, storeId: order.storeId, stockDeductedAt: null }, data: { stockDeductedAt: now } });
  if (claimed.count !== 1) return null;
  const alerts: StockAlert[] = [];
  const items = (
    await tx.orderItem.findMany({ where: { orderId: order.id }, select: { id: true, productId: true, quantity: true, weightGrams: true, options: { select: { optionId: true, quantity: true } }, additionals: { select: { additionalId: true } } } })
  ).map((i) => ({
    ...i,
    // Adicional LEGADO = opção-espelho com o mesmo id (quantidade 1 por unidade do item)
    options: [...i.options, ...i.additionals.map((a) => ({ optionId: a.additionalId, quantity: 1 }))],
  }));
  const recipes = await loadRecipes(
    tx,
    order.storeId,
    [...new Set(items.map((i) => i.productId).filter((id): id is string => !!id))],
    [...new Set(items.flatMap((i) => i.options.map((o) => o.optionId)).filter((id): id is string => !!id))],
  );
  const usage = consumptionOf(items, recipes);
  const ids = [...usage.keys()].sort();
  // Custo médio ANTES da baixa (as saídas não mudam o médio): custo de cada linha do pedido, para a margem por prato.
  const costs = new Map(
    ids.length ? (await tx.ingredient.findMany({ where: { storeId: order.storeId, id: { in: ids } }, select: { id: true, unitCostMillicents: true } })).map((i) => [i.id, i.unitCostMillicents]) : [],
  );
  for (const item of items) {
    let lineMilli = 0;
    for (const [ingredientId, qty] of consumptionOf([item], recipes)) lineMilli += qty * (costs.get(ingredientId) ?? 0);
    await tx.orderItem.update({ where: { id: item.id }, data: { cogsCents: Math.round(lineMilli / MILLI) } });
  }
  let cogs = 0;
  for (const ingredientId of ids) {
    const movement = await applyMovement(tx, { storeId: order.storeId, ingredientId, type: "SALE", quantity: -usage.get(ingredientId)!, orderId: order.id, now });
    cogs += -movement.costCents;
    if (movement.alert) alerts.push(movement.alert);
  }
  await tx.order.update({ where: { id: order.id }, data: { cogsCents: cogs } });
  return { cogsCents: cogs, alerts };
}

/**
 * Estorno da baixa (cancelamento ou "desfazer aceite"): devolve o saldo LÍQUIDO do pedido ao custo da baixa. Idempotente.
 * `asWaste` (cancelamento de pedido JÁ PREPARADO): a comida foi feita e jogada fora; o estorno da VENDA acontece (o pedido não
 * vendeu, sai do CMV), mas cada insumo sai de novo como DESPERDÍCIO (motivo PEDIDO_CANCELADO): o saldo fica como estava e o custo
 * vai para as perdas do DRE.
 */
export async function reverseStockForOrder(tx: Tx, order: { id: string; storeId: string }, now: Date, asWaste?: { userId: string | null }): Promise<void> {
  const released = await tx.order.updateMany({ where: { id: order.id, storeId: order.storeId, stockDeductedAt: { not: null } }, data: { stockDeductedAt: null, stockReversedAt: now, cogsCents: null } });
  if (released.count !== 1) return;
  await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { cogsCents: null } });
  const net = await tx.stockMovement.groupBy({ by: ["ingredientId"], where: { orderId: order.id, storeId: order.storeId }, _sum: { quantity: true, costCents: true } });
  for (const row of net.sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))) {
    const qty = -(row._sum.quantity ?? 0);
    if (qty <= 0) continue;
    const unitCost = Math.round((-(row._sum.costCents ?? 0) * MILLI) / qty);
    await applyMovement(tx, { storeId: order.storeId, ingredientId: row.ingredientId, type: "SALE_REVERSAL", quantity: qty, unitCostMillicents: Math.max(0, unitCost), orderId: order.id, now });
    if (asWaste) {
      await applyMovement(tx, { storeId: order.storeId, ingredientId: row.ingredientId, type: "WASTE", quantity: -qty, reason: ORDER_CANCELED_WASTE_REASON, orderId: order.id, userId: asWaste.userId, now });
    }
  }
}

/**
 * Desfaz um lançamento de PERDA manual (e, se for perda de prato, todas as linhas do prato): cada linha ganha uma contrapartida
 * do mesmo tipo e motivo, com a quantidade ao contrário e o MESMO custo unitário (o saldo e o custo médio voltam). Idempotente pelo
 * `reversalOfId` único. Devolve as linhas desfeitas, ou um código de recusa.
 */
export async function undoLoss(tx: Tx, input: { storeId: string; movementId: string; userId: string | null; now: Date }): Promise<
  { ok: true; undone: { id: string; ingredientId: string; quantity: number; createdAt: Date; userId: string | null }[] } | { ok: false; code: "STOCK_MOVEMENT_NOT_FOUND" | "LOSS_NOT_UNDOABLE" | "LOSS_ALREADY_UNDONE" }
> {
  const target = await tx.stockMovement.findFirst({ where: { id: input.movementId, storeId: input.storeId } });
  if (!target) return { ok: false, code: "STOCK_MOVEMENT_NOT_FOUND" };
  const rows = target.groupId ? await tx.stockMovement.findMany({ where: { storeId: input.storeId, groupId: target.groupId, reversalOfId: null } }) : [target];
  if (rows.some((m) => (m.type !== "WASTE" && m.type !== "SPOILAGE") || m.orderId !== null || m.reversalOfId !== null)) return { ok: false, code: "LOSS_NOT_UNDOABLE" };
  if (await tx.stockMovement.count({ where: { reversalOfId: { in: rows.map((m) => m.id) } } })) return { ok: false, code: "LOSS_ALREADY_UNDONE" };
  for (const m of [...rows].sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))) {
    await applyMovement(tx, {
      storeId: input.storeId, ingredientId: m.ingredientId, type: m.type, quantity: -m.quantity, unitCostMillicents: m.unitCostMillicents,
      reason: m.reason ?? undefined, groupId: m.groupId ?? undefined, reversalOfId: m.id, userId: input.userId, now: input.now,
    });
  }
  return { ok: true, undone: rows.map((m) => ({ id: m.id, ingredientId: m.ingredientId, quantity: m.quantity, createdAt: m.createdAt, userId: m.userId })) };
}

/**
 * Perda de PRATO PRONTO: a baixa sai pela ficha técnica do produto (como uma venda), mas como DESPERDÍCIO com motivo.
 * Insumos em ordem de id (mesma ordem de trava da venda). Produto sem ficha => null (quem chama responde PRODUCT_NO_RECIPE).
 */
export async function wasteProduct(
  tx: Tx,
  input: { storeId: string; productId: string; quantity: number; weightGrams?: number; reason: string; note?: string; userId: string | null; now: Date },
): Promise<{ costCents: number; movementIds: string[]; alerts: StockAlert[] } | null> {
  const recipes = await loadRecipes(tx, input.storeId, [input.productId], []);
  // Por peso: a ficha é por 1 kg; `weightGrams` é o peso de CADA unidade perdida.
  const line: ConsumptionLine = { productId: input.productId, quantity: input.quantity, weightGrams: input.weightGrams !== undefined ? input.weightGrams * input.quantity : null, options: [] };
  const usage = consumptionOf([line], recipes);
  if (usage.size === 0) return null;
  let costCents = 0;
  const movementIds: string[] = [];
  const groupId = randomUUID(); // "desfazer" uma linha desfaz o prato inteiro
  const alerts: StockAlert[] = [];
  for (const ingredientId of [...usage.keys()].sort()) {
    const movement = await applyMovement(tx, { storeId: input.storeId, ingredientId, type: "WASTE", quantity: -usage.get(ingredientId)!, reason: input.reason, note: input.note, groupId, userId: input.userId, now: input.now });
    costCents += -movement.costCents;
    movementIds.push(movement.id);
    if (movement.alert) alerts.push(movement.alert);
  }
  return { costCents, movementIds, alerts };
}
