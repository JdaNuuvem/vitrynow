import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, prisma } from "@meucardapio/db";
import {
  createIngredientSchema, panelRoleSchema, productLossSchema, recipeSchema, stockCountSchema, stockLossSchema, stockMovementsQuerySchema, stockPurchaseSchema, updateIngredientSchema,
} from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { buildReport, resolveRange } from "../lib/reports";
import { utc } from "../lib/sqlTime";
import { applyMovement, costCentsOf, MILLI, unitCostFromTotal, wasteProduct } from "../lib/stock";
import { storeTimeZone } from "../lib/storeTz";
import { CodedError, useDomainErrors } from "../shared/errors";
import { publishToStore } from "../realtime/hub";
import { reais, toCsv, type ReportRange } from "../lib/reports";

// ESTOQUE E LUCRO (todos os planos). Permissões: a EQUIPE vê insumos e saldos e lança compra e perda; o DONO cria/edita insumo,
// monta ficha técnica, faz contagem (ajuste) e vê CUSTO e LUCRO (dinheiro é do dono, RN-R-06: o STAFF nunca recebe campo de custo).
// Toda movimentação manual vai para a auditoria. Nada se apaga: insumo só se desativa.

const MAX_INGREDIENTS = 500;
const MOVEMENTS_PAGE = 100;

function bad(reply: FastifyReply, error: { flatten: () => { fieldErrors: unknown } }) {
  return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: error.flatten().fieldErrors });
}
const isOwner = (request: FastifyRequest) => request.user.role === panelRoleSchema.enum.OWNER;
const notFound = () => new CodedError(404, "INGREDIENT_NOT_FOUND", "Insumo não encontrado.");

type IngredientRow = { id: string; name: string; unit: string; stockQty: number; minStockQty: number | null; unitCostMillicents: number; active: boolean };
const ingredientView = (i: IngredientRow, owner: boolean) => ({
  id: i.id,
  name: i.name,
  unit: i.unit,
  stockQty: i.stockQty,
  minStockQty: i.minStockQty,
  active: i.active,
  lowStock: i.minStockQty !== null && i.stockQty <= i.minStockQty,
  negative: i.stockQty < 0,
  ...(owner ? { unitCostMillicents: i.unitCostMillicents, stockValueCents: Math.max(0, costCentsOf(i.stockQty, i.unitCostMillicents)) } : {}),
});

const stockRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);
  const owner = { preHandler: [app.requirePanelAuth, app.requireOwner] };
  const panel = { preHandler: app.requirePanelAuth };

  async function requireIngredient(storeId: string, id: string) {
    const ingredient = await prisma.ingredient.findFirst({ where: { id, storeId } });
    if (!ingredient) throw notFound();
    return ingredient;
  }

  // ---------- Insumos ----------
  app.get("/api/stock/ingredients", panel, async (request) => {
    const { storeId } = request.user;
    const rows = await prisma.ingredient.findMany({ where: { storeId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
    const view = rows.map((i) => ingredientView(i, isOwner(request)));
    return {
      ingredients: view,
      alerts: { lowStock: view.filter((i) => i.active && i.lowStock).length, negative: view.filter((i) => i.active && i.negative).length },
      ...(isOwner(request) ? { stockValueCents: view.reduce((sum, i) => sum + (i.active ? (i as { stockValueCents?: number }).stockValueCents ?? 0 : 0), 0) } : {}),
    };
  });

  app.post("/api/stock/ingredients", owner, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = createIngredientSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error);
    if ((await prisma.ingredient.count({ where: { storeId } })) >= MAX_INGREDIENTS) throw new CodedError(409, "INGREDIENT_LIMIT_REACHED", `A loja já tem ${MAX_INGREDIENTS} insumos (o máximo).`);
    try {
      const ingredient = await prisma.ingredient.create({ data: { storeId, name: parsed.data.name, unit: parsed.data.unit, minStockQty: parsed.data.minStockQty ?? null } });
      logAudit({ storeId, userId, action: "stock.ingredient_create", targetType: "Ingredient", targetId: ingredient.id, metadata: { name: ingredient.name, unit: ingredient.unit } });
      return reply.code(201).send({ ingredient: ingredientView(ingredient, true) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CodedError(409, "INGREDIENT_NAME_TAKEN", "Já existe um insumo com esse nome.");
      throw error;
    }
  });

  app.patch("/api/stock/ingredients/:id", owner, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = updateIngredientSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error);
    await requireIngredient(storeId, id);
    try {
      const ingredient = await prisma.ingredient.update({ where: { id }, data: parsed.data });
      logAudit({ storeId, userId, action: "stock.ingredient_update", targetType: "Ingredient", targetId: id, metadata: parsed.data });
      return { ingredient: ingredientView(ingredient, true) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CodedError(409, "INGREDIENT_NAME_TAKEN", "Já existe um insumo com esse nome.");
      throw error;
    }
  });

  // ---------- Movimentações manuais ----------
  // Compra/entrada (equipe e dono): recalcula o custo médio. A equipe lança o valor pago, mas não vê o custo resultante.
  app.post("/api/stock/ingredients/:id/purchase", panel, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = stockPurchaseSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error);
    await requireIngredient(storeId, id);
    const unitCost = unitCostFromTotal(parsed.data.totalCostCents, parsed.data.quantity);
    const movement = await prisma.$transaction((tx) => applyMovement(tx, { storeId, ingredientId: id, type: "PURCHASE", quantity: parsed.data.quantity, unitCostMillicents: unitCost, userId, now: new Date() }));
    logAudit({ storeId, userId, action: "stock.purchase", targetType: "Ingredient", targetId: id, metadata: { quantity: parsed.data.quantity, totalCostCents: parsed.data.totalCostCents } });
    const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { id } });
    return reply.code(201).send({ movementId: movement.id, ingredient: ingredientView(ingredient, isOwner(request)) });
  });

  // Perda (equipe e dono): desperdício no preparo ou item estragado/vencido, sai pelo custo médio do momento.
  app.post("/api/stock/ingredients/:id/loss", panel, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = stockLossSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error);
    await requireIngredient(storeId, id);
    const movement = await prisma.$transaction((tx) => applyMovement(tx, { storeId, ingredientId: id, type: parsed.data.type, quantity: -parsed.data.quantity, reason: parsed.data.reason, userId, now: new Date() }));
    if (movement.alert) publishToStore(storeId, { type: "stock.low", ...movement.alert });
    logAudit({ storeId, userId, action: "stock.loss", targetType: "Ingredient", targetId: id, metadata: { type: parsed.data.type, reason: parsed.data.reason, quantity: parsed.data.quantity } });
    const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { id } });
    return reply.code(201).send({ movementId: movement.id, ingredient: ingredientView(ingredient, isOwner(request)) });
  });

  // Perda de PRATO PRONTO (equipe e dono): "caiu um ramen" vira a baixa de todos os insumos da ficha, como desperdício com motivo.
  app.post("/api/stock/products/:id/loss", panel, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = productLossSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error);
    const product = await prisma.product.findFirst({ where: { id, storeId }, select: { id: true, name: true } });
    if (!product) throw new CodedError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
    const result = await prisma.$transaction((tx) =>
      wasteProduct(tx, { storeId, productId: id, quantity: parsed.data.quantity, weightGrams: parsed.data.weightGrams, reason: parsed.data.reason, userId, now: new Date() }));
    if (!result) throw new CodedError(409, "PRODUCT_NO_RECIPE", "Este produto não tem ficha técnica. Monte a ficha ou lance a perda por insumo.");
    for (const alert of result.alerts) publishToStore(storeId, { type: "stock.low", ...alert });
    logAudit({ storeId, userId, action: "stock.product_loss", targetType: "Product", targetId: id, metadata: { quantity: parsed.data.quantity, weightGrams: parsed.data.weightGrams ?? null, reason: parsed.data.reason, costCents: result.costCents } });
    return reply.code(201).send({ movementIds: result.movementIds, ingredients: result.movementIds.length, ...(isOwner(request) ? { costCents: result.costCents } : {}) });
  });

  // Contagem (só o dono): o saldo vira o contado; a diferença é um AJUSTE (sobra entra, falta sai pelo custo médio).
  app.post("/api/stock/ingredients/:id/count", owner, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = stockCountSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error);
    await requireIngredient(storeId, id);
    const result = await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ stockQty: number }[]>`SELECT "stockQty" FROM "Ingredient" WHERE "id" = ${id} AND "storeId" = ${storeId} FOR UPDATE`;
      const diff = parsed.data.countedQty - row.stockQty;
      if (diff === 0) return { diff, movementId: null, alert: null };
      const movement = await applyMovement(tx, { storeId, ingredientId: id, type: "ADJUSTMENT", quantity: diff, reason: diff > 0 ? "CONTAGEM_SOBRA" : "CONTAGEM_FALTA", userId, now: new Date() });
      return { diff, movementId: movement.id, alert: movement.alert };
    });
    if (result.alert) publishToStore(storeId, { type: "stock.low", ...result.alert });
    logAudit({ storeId, userId, action: "stock.count", targetType: "Ingredient", targetId: id, metadata: { countedQty: parsed.data.countedQty, diff: result.diff } });
    const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { id } });
    return reply.code(201).send({ diff: result.diff, movementId: result.movementId, ingredient: ingredientView(ingredient, true) });
  });

  app.get("/api/stock/movements", panel, async (request, reply) => {
    const { storeId } = request.user;
    const parsed = stockMovementsQuerySchema.safeParse(request.query);
    if (!parsed.success) return bad(reply, parsed.error);
    const q = parsed.data;
    const range = q.from || q.to ? resolveRange({ from: q.from, to: q.to }, new Date(), await storeTimeZone(storeId)) : null;
    if (range && "error" in range) return reply.code(400).send({ error: "Período inválido.", code: "REPORT_RANGE_INVALID" });
    const rows = await prisma.stockMovement.findMany({
      where: {
        storeId,
        ...(q.ingredientId ? { ingredientId: q.ingredientId } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(range ? { createdAt: { gte: range.fromUtc, lt: range.toExclusiveUtc } } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MOVEMENTS_PAGE + 1,
      include: { ingredient: { select: { name: true, unit: true } } },
    });
    const page = rows.slice(0, MOVEMENTS_PAGE);
    const owner = isOwner(request);
    return {
      movements: page.map((m) => ({
        id: m.id, type: m.type, quantity: m.quantity, reason: m.reason, orderId: m.orderId, userId: m.userId, createdAt: m.createdAt,
        ingredient: { id: m.ingredientId, ...m.ingredient },
        ...(owner ? { unitCostMillicents: m.unitCostMillicents, costCents: m.costCents } : {}),
      })),
      nextCursor: rows.length > MOVEMENTS_PAGE ? page[page.length - 1].id : null,
    };
  });

  // ---------- Ficha técnica (só o dono) ----------
  async function saveRecipe(storeId: string, items: { ingredientId: string; quantity: number }[], write: (tx: Prisma.TransactionClient) => Promise<void>) {
    const ids = items.map((i) => i.ingredientId);
    const owned = ids.length ? await prisma.ingredient.count({ where: { storeId, id: { in: ids } } }) : 0;
    if (owned !== ids.length) throw notFound(); // SEC-11: insumo de outra loja não existe para esta
    await prisma.$transaction(write);
  }
  const recipeView = async (rows: { ingredientId: string; quantity: number }[], owner: boolean) => {
    const ingredients = await prisma.ingredient.findMany({ where: { id: { in: rows.map((r) => r.ingredientId) } }, select: { id: true, name: true, unit: true, unitCostMillicents: true } });
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const items = rows.map((r) => {
      const i = byId.get(r.ingredientId)!;
      return { ingredientId: r.ingredientId, name: i.name, unit: i.unit, quantity: r.quantity, ...(owner ? { costCents: costCentsOf(r.quantity, i.unitCostMillicents) } : {}) };
    });
    return { items, ...(owner ? { costCents: Math.round(rows.reduce((s, r) => s + r.quantity * (byId.get(r.ingredientId)?.unitCostMillicents ?? 0), 0) / MILLI) } : {}) };
  };

  app.get("/api/stock/products/:id/recipe", panel, async (request) => {
    const { storeId } = request.user;
    const { id } = request.params as { id: string };
    const product = await prisma.product.findFirst({ where: { id, storeId }, select: { id: true, saleUnit: true } });
    if (!product) throw new CodedError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
    const rows = await prisma.recipeItem.findMany({ where: { storeId, productId: id }, orderBy: { id: "asc" } });
    return { productId: id, perKilo: product.saleUnit !== "UN", ...(await recipeView(rows, isOwner(request))) };
  });

  app.put("/api/stock/products/:id/recipe", owner, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = recipeSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error);
    const product = await prisma.product.findFirst({ where: { id, storeId }, select: { id: true, name: true } });
    if (!product) throw new CodedError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
    await saveRecipe(storeId, parsed.data.items, async (tx) => {
      await tx.recipeItem.deleteMany({ where: { storeId, productId: id } });
      if (parsed.data.items.length) await tx.recipeItem.createMany({ data: parsed.data.items.map((i) => ({ storeId, productId: id, ingredientId: i.ingredientId, quantity: i.quantity })) });
    });
    logAudit({ storeId, userId, action: "stock.recipe_product", targetType: "Product", targetId: id, metadata: { name: product.name, items: parsed.data.items } });
    return recipeView(await prisma.recipeItem.findMany({ where: { storeId, productId: id }, orderBy: { id: "asc" } }), true);
  });

  app.get("/api/stock/options/:id/recipe", panel, async (request) => {
    const { storeId } = request.user;
    const { id } = request.params as { id: string };
    if (!(await prisma.option.findFirst({ where: { id, storeId }, select: { id: true } }))) throw new CodedError(404, "OPTION_NOT_FOUND", "Opção não encontrada.");
    return { optionId: id, ...(await recipeView(await prisma.optionRecipeItem.findMany({ where: { storeId, optionId: id }, orderBy: { id: "asc" } }), isOwner(request))) };
  });

  app.put("/api/stock/options/:id/recipe", owner, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = recipeSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error);
    const option = await prisma.option.findFirst({ where: { id, storeId }, select: { id: true, name: true } });
    if (!option) throw new CodedError(404, "OPTION_NOT_FOUND", "Opção não encontrada.");
    await saveRecipe(storeId, parsed.data.items, async (tx) => {
      await tx.optionRecipeItem.deleteMany({ where: { storeId, optionId: id } });
      if (parsed.data.items.length) await tx.optionRecipeItem.createMany({ data: parsed.data.items.map((i) => ({ storeId, optionId: id, ingredientId: i.ingredientId, quantity: i.quantity })) });
    });
    logAudit({ storeId, userId, action: "stock.recipe_option", targetType: "Option", targetId: id, metadata: { name: option.name, items: parsed.data.items } });
    return recipeView(await prisma.optionRecipeItem.findMany({ where: { storeId, optionId: id }, orderBy: { id: "asc" } }), true);
  });

  // ---------- Lucro (só o dono) ----------
  // Margem do CARDÁPIO hoje: preço de venda × custo da ficha técnica pelo custo médio atual. Mostra o que dá prejuízo antes de vender.
  app.get("/api/stock/menu-margins", owner, async (request) => {
    const { storeId } = request.user;
    const products = await prisma.product.findMany({
      where: { storeId, active: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, priceCents: true, promoCents: true, saleUnit: true, recipeItems: { select: { quantity: true, ingredient: { select: { unitCostMillicents: true } } } } },
    });
    return {
      products: products.map((p) => {
        const costCents = Math.round(p.recipeItems.reduce((s, r) => s + r.quantity * r.ingredient.unitCostMillicents, 0) / MILLI);
        const marginCents = p.priceCents - costCents;
        return {
          id: p.id, name: p.name, priceCents: p.priceCents, perKilo: p.saleUnit !== "UN", hasRecipe: p.recipeItems.length > 0, costCents, marginCents,
          marginPercent: p.priceCents > 0 ? Math.round((marginCents * 1000) / p.priceCents) / 10 : null,
          costPercent: p.priceCents > 0 ? Math.round((costCents * 1000) / p.priceCents) / 10 : null, // "CMV %" do prato
        };
      }),
    };
  });

  // DRE simplificado do período: faturamento (mesma definição dos relatórios), CMV das vendas, lucro bruto, perdas (desperdício,
  // estragado, ajuste de contagem) e resultado depois das perdas; mais margem REAL por prato (custo gravado em cada venda).
  app.get("/api/stock/profit", owner, async (request, reply) => {
    const { storeId } = request.user;
    const query = request.query as { from?: unknown; to?: unknown };
    if ((query.from !== undefined && typeof query.from !== "string") || (query.to !== undefined && typeof query.to !== "string")) return reply.code(400).send({ error: "datas inválidas" });
    const range = resolveRange({ from: query.from as string | undefined, to: query.to as string | undefined }, new Date(), await storeTimeZone(storeId));
    if ("error" in range) return reply.code(400).send({ error: "Período inválido.", code: "REPORT_RANGE_INVALID" });
    return buildProfit(storeId, range);
  });

  // CSV do lucro (Excel brasileiro: ";", vírgula decimal, BOM). Só o dono; toda exportação na auditoria.
  const PROFIT_TABLES = ["summary", "products", "losses", "movements"] as const;
  app.get("/api/stock/export.csv", { ...owner, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const query = request.query as { from?: unknown; to?: unknown; table?: string };
    const table = (query.table ?? "summary") as (typeof PROFIT_TABLES)[number];
    if (!(PROFIT_TABLES as readonly string[]).includes(table)) return reply.code(400).send({ error: "Tabela inválida.", code: "INVALID_TABLE", tables: PROFIT_TABLES });
    if ((query.from !== undefined && typeof query.from !== "string") || (query.to !== undefined && typeof query.to !== "string")) return reply.code(400).send({ error: "datas inválidas" });
    const range = resolveRange({ from: query.from as string | undefined, to: query.to as string | undefined }, new Date(), await storeTimeZone(storeId));
    if ("error" in range) return reply.code(400).send({ error: "Período inválido.", code: "REPORT_RANGE_INVALID" });
    let rows: (string | number)[][];
    if (table === "movements") {
      const list = await prisma.stockMovement.findMany({ where: { storeId, createdAt: { gte: range.fromUtc, lt: range.toExclusiveUtc } }, orderBy: { createdAt: "asc" }, take: 50_000, include: { ingredient: { select: { name: true, unit: true } } } });
      rows = [["Data", "Insumo", "Unidade", "Tipo", "Motivo", "Quantidade", "Custo (R$)", "Pedido"], ...list.map((m) => [m.createdAt.toISOString(), m.ingredient.name, m.ingredient.unit, MOVEMENT_LABEL[m.type], m.reason ?? "", m.quantity, reais(m.costCents), m.orderId ?? ""])];
    } else {
      const p = await buildProfit(storeId, range);
      rows =
        table === "summary"
          ? [
              ["Indicador", "Valor"],
              ["Período", `${p.fromDate} a ${p.toDate}`],
              ["Faturamento (R$)", reais(p.revenueCents)],
              ["Vendas", p.orderCount],
              ["CMV (R$)", reais(p.cogsCents)],
              ["CMV (%)", p.cogsPercent ?? ""],
              ["Lucro bruto (R$)", reais(p.grossProfitCents)],
              ["Margem bruta (%)", p.grossMarginPercent ?? ""],
              ["Desperdício (R$)", reais(p.losses.wasteCents)],
              ["Estragado/vencido (R$)", reais(p.losses.spoilageCents)],
              ["Ajuste de contagem (R$)", reais(p.losses.adjustmentCents)],
              ["Perdas totais (R$)", reais(p.losses.totalCents)],
              ["Resultado após perdas (R$)", reais(p.resultAfterLossesCents)],
              ["Compras no período (R$)", reais(p.purchasesCents)],
            ]
          : table === "products"
            ? [["Produto", "Quantidade", "Faturamento (R$)", "CMV (R$)", "Lucro (R$)", "Margem (%)"], ...p.products.map((r) => [r.productName, r.quantity, reais(r.revenueCents), reais(r.cogsCents), reais(r.profitCents), r.marginPercent ?? ""])]
            : [["Tipo", "Motivo", "Lançamentos", "Custo (R$)"], ...p.lossesByReason.map((r) => [MOVEMENT_LABEL[r.type as keyof typeof MOVEMENT_LABEL] ?? r.type, r.reason, r.count, reais(r.costCents)])];
    }
    logAudit({ storeId, userId, action: "stock.export", targetType: "Store", targetId: storeId, metadata: { table, from: range.fromDate, to: range.toDate } });
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="estoque-${table}-${range.fromDate}-a-${range.toDate}.csv"`)
      .header("Cache-Control", "no-store")
      .send(toCsv(rows));
  });
};

const MOVEMENT_LABEL = { PURCHASE: "Compra", SALE: "Venda", SALE_REVERSAL: "Estorno de venda", WASTE: "Desperdício", SPOILAGE: "Estragado/vencido", ADJUSTMENT: "Ajuste de contagem" } as const;

// DRE simplificado do período (usado pela tela e pelo CSV).
async function buildProfit(storeId: string, range: ReportRange) {
    const window = Prisma.sql`m."storeId" = ${storeId} AND m."createdAt" >= ${utc(range.fromUtc)} AND m."createdAt" < ${utc(range.toExclusiveUtc)}`;

    const [report, byType, byReason, wastedIngredients, products, purchases] = await Promise.all([
      buildReport(storeId, range),
      prisma.$queryRaw<{ type: string; cost: bigint }[]>(Prisma.sql`SELECT m."type"::text AS "type", coalesce(sum(m."costCents"), 0)::bigint AS "cost" FROM "StockMovement" m WHERE ${window} GROUP BY 1`),
      prisma.$queryRaw<{ type: string; reason: string; cost: bigint; count: bigint }[]>(Prisma.sql`
        SELECT m."type"::text AS "type", coalesce(m."reason", 'OUTRO') AS "reason", (-sum(m."costCents"))::bigint AS "cost", count(*) AS "count"
        FROM "StockMovement" m WHERE ${window} AND m."type" IN ('WASTE', 'SPOILAGE') GROUP BY 1, 2 ORDER BY 3 DESC`),
      prisma.$queryRaw<{ id: string; name: string; unit: string; quantity: bigint; cost: bigint }[]>(Prisma.sql`
        SELECT i."id", i."name", i."unit"::text AS "unit", (-sum(m."quantity"))::bigint AS "quantity", (-sum(m."costCents"))::bigint AS "cost"
        FROM "StockMovement" m JOIN "Ingredient" i ON i."id" = m."ingredientId"
        WHERE ${window} AND m."type" IN ('WASTE', 'SPOILAGE') GROUP BY i."id", i."name", i."unit" ORDER BY 5 DESC LIMIT 10`),
      // Margem real por prato: pedidos com baixa ativa (aceitos e não cancelados) cuja baixa caiu no período.
      prisma.$queryRaw<{ key: string; name: string; quantity: bigint; revenue: bigint; cost: bigint; costed: bigint }[]>(Prisma.sql`
        SELECT coalesce(i."productId", i."productName") AS "key", max(i."productName") AS "name", sum(i."quantity") AS "quantity",
               sum((i."unitPriceCents" + coalesce(a."extra", 0)) * i."quantity")::bigint AS "revenue",
               coalesce(sum(i."cogsCents"), 0)::bigint AS "cost", count(i."cogsCents") AS "costed"
        FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
        LEFT JOIN LATERAL (SELECT sum(x."priceCents") AS "extra" FROM "OrderItemAdditional" x WHERE x."orderItemId" = i."id") a ON true
        WHERE o."storeId" = ${storeId} AND o."stockDeductedAt" IS NOT NULL AND o."status" <> 'CANCELADO'
          AND o."stockDeductedAt" >= ${utc(range.fromUtc)} AND o."stockDeductedAt" < ${utc(range.toExclusiveUtc)}
        GROUP BY 1 ORDER BY 4 DESC LIMIT 100`),
      prisma.$queryRaw<{ cost: bigint }[]>(Prisma.sql`SELECT coalesce(sum(m."costCents"), 0)::bigint AS "cost" FROM "StockMovement" m WHERE ${window} AND m."type" = 'PURCHASE'`),
    ]);
    const sum = (types: string[]) => byType.filter((r) => types.includes(r.type)).reduce((s, r) => s + Number(r.cost), 0);
    const cogsCents = -sum(["SALE", "SALE_REVERSAL"]); // saídas são negativas
    const wasteCents = -sum(["WASTE"]);
    const spoilageCents = -sum(["SPOILAGE"]);
    const adjustmentCents = -sum(["ADJUSTMENT"]); // > 0 = falta na contagem (perda); < 0 = sobra
    const revenueCents = report.revenueCents;
    const grossProfitCents = revenueCents - cogsCents;
    const lossesCents = wasteCents + spoilageCents + adjustmentCents;
    const pct = (part: number) => (revenueCents > 0 ? Math.round((part * 1000) / revenueCents) / 10 : null);
    return {
      fromDate: range.fromDate,
      toDate: range.toDate,
      timeZone: range.timeZone,
      revenueCents,
      orderCount: report.orderCount,
      cogsCents,
      cogsPercent: pct(cogsCents),
      grossProfitCents,
      grossMarginPercent: pct(grossProfitCents),
      losses: { wasteCents, spoilageCents, adjustmentCents, totalCents: lossesCents, percentOfRevenue: pct(lossesCents) },
      resultAfterLossesCents: grossProfitCents - lossesCents,
      purchasesCents: Number(purchases[0].cost),
      lossesByReason: byReason.map((r) => ({ type: r.type, reason: r.reason, count: Number(r.count), costCents: Number(r.cost) })),
      topWastedIngredients: wastedIngredients.map((r) => ({ id: r.id, name: r.name, unit: r.unit, quantity: Number(r.quantity), costCents: Number(r.cost) })),
      products: products.map((r) => {
        const revenue = Number(r.revenue);
        const cost = Number(r.cost);
        return {
          productName: r.name, quantity: Number(r.quantity), revenueCents: revenue, cogsCents: cost, profitCents: revenue - cost,
          marginPercent: revenue > 0 ? Math.round(((revenue - cost) * 1000) / revenue) / 10 : null,
          hasCost: Number(r.costed) > 0 && cost > 0,
        };
      }),
  };
}

export default stockRoutes;
