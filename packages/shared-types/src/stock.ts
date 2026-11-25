import { z } from "zod";

// ESTOQUE E LUCRO (todos os planos). Quantidades SEMPRE em unidade base inteira: grama (G), mililitro (ML) ou unidade (UN).
// A tela converte kg/L para a base antes de enviar. Dinheiro em centavos.

export const STOCK_UNITS = ["G", "ML", "UN"] as const;
export const stockUnitSchema = z.enum(STOCK_UNITS);

const qty = z.number().int().positive().max(100_000_000); // até 100 t / 100 mil L / 100 milhões un
const name = z.string().trim().min(1).max(80);

export const createIngredientSchema = z.object({
  name,
  unit: stockUnitSchema,
  minStockQty: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
}).strict();
export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;

export const updateIngredientSchema = z.object({
  name: name.optional(),
  minStockQty: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
  active: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "nada para alterar");

// Compra/entrada: quanto entrou e quanto custou NO TOTAL (a API calcula o custo unitário e o novo custo médio).
export const stockPurchaseSchema = z.object({
  quantity: qty,
  totalCostCents: z.number().int().nonnegative().max(1_000_000_000),
}).strict();

// Perda: desperdício no preparo ou item estragado/vencido. Motivo em LISTA FECHADA (sem texto livre).
export const WASTE_REASONS = ["PREPARO", "QUEIMOU", "CAIU", "ERRO_PEDIDO", "DEVOLUCAO_CLIENTE", "AMOSTRA", "OUTRO"] as const;
export const SPOILAGE_REASONS = ["VENCIDO", "ESTRAGOU", "ARMAZENAMENTO", "OUTRO"] as const;
export const stockLossSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("WASTE"), quantity: qty, reason: z.enum(WASTE_REASONS) }).strict(),
  z.object({ type: z.literal("SPOILAGE"), quantity: qty, reason: z.enum(SPOILAGE_REASONS) }).strict(),
]);
export type StockLossInput = z.infer<typeof stockLossSchema>;

// Contagem (só o dono): o saldo vira o contado; a diferença vira um ajuste registrado.
export const stockCountSchema = z.object({ countedQty: z.number().int().min(0).max(100_000_000) }).strict();

// Ficha técnica: lista completa (substitui a anterior). Vazia = o item não consome estoque.
export const recipeSchema = z.object({
  items: z.array(z.object({ ingredientId: z.string().min(1).max(50), quantity: qty }).strict()).max(50),
}).strict().refine((v) => new Set(v.items.map((i) => i.ingredientId)).size === v.items.length, "insumo repetido na ficha");
export type RecipeInput = z.infer<typeof recipeSchema>;

export const STOCK_MOVEMENT_TYPES = ["PURCHASE", "SALE", "SALE_REVERSAL", "WASTE", "SPOILAGE", "ADJUSTMENT"] as const;
export const stockMovementsQuerySchema = z.object({
  ingredientId: z.string().min(1).max(50).optional(),
  type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  cursor: z.string().max(200).optional(),
});
