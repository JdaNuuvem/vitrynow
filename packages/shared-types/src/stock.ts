import { z } from "zod";
import { textField } from "./text";

// ESTOQUE E LUCRO (todos os planos). Quantidades SEMPRE em unidade base inteira: grama (G), mililitro (ML) ou unidade (UN).
// A tela converte kg/L para a base antes de enviar. Dinheiro em centavos.

export const STOCK_UNITS = ["G", "ML", "UN"] as const;
export const stockUnitSchema = z.enum(STOCK_UNITS);

const qty = z.number().int().positive().max(100_000_000); // até 100 t / 100 mil L / 100 milhões un
const name = textField({ max: 80, min: 1 });

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
  // Validade do lote comprado (opcional, AAAA-MM-DD). O estoque estima o lote em uso por PEPS (o mais novo fica por último).
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }, "data inválida").optional(),
}).strict();

// Observação da perda (obrigatória no motivo OUTRO): curta, só para a loja.
export const LOSS_NOTE_MAX = 200;
const lossNote = textField({ max: LOSS_NOTE_MAX, min: 1 }).optional();
const needsNote = (v: { reason: string; note?: string }) => v.reason !== "OUTRO" || !!v.note;
const NOTE_REQUIRED = { message: "Escreva a observação do motivo Outro.", path: ["note"] };

// Perda: desperdício no preparo ou item estragado/vencido. Motivo em LISTA FECHADA (sem texto livre).
export const WASTE_REASONS = ["PREPARO", "QUEIMOU", "CAIU", "ERRO_PEDIDO", "DEVOLUCAO_CLIENTE", "AMOSTRA", "OUTRO"] as const;
export const SPOILAGE_REASONS = ["VENCIDO", "ESTRAGOU", "ARMAZENAMENTO", "OUTRO"] as const;
export const stockLossSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("WASTE"), quantity: qty, reason: z.enum(WASTE_REASONS), note: lossNote }).strict(),
  z.object({ type: z.literal("SPOILAGE"), quantity: qty, reason: z.enum(SPOILAGE_REASONS), note: lossNote }).strict(),
]).refine(needsNote, NOTE_REQUIRED);
export type StockLossInput = z.infer<typeof stockLossSchema>;

// Perda de PRATO PRONTO (caiu, queimou, erro): a baixa sai pela ficha técnica do produto. Produto por peso: `weightGrams` por unidade.
export const productLossSchema = z.object({
  quantity: z.number().int().positive().max(100),
  weightGrams: z.number().int().positive().max(100_000).optional(),
  reason: z.enum(WASTE_REASONS),
  note: lossNote,
}).strict().refine(needsNote, NOTE_REQUIRED);
export type ProductLossInput = z.infer<typeof productLossSchema>;

// Motivo só do SISTEMA: pedido aceito, já preparado, e cancelado (os insumos não voltam ao estoque, viram desperdício).
export const ORDER_CANCELED_WASTE_REASON = "PEDIDO_CANCELADO";

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
  // LOSS = desperdício + estragado (histórico de perdas)
  type: z.enum([...STOCK_MOVEMENT_TYPES, "LOSS"]).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  cursor: z.string().max(200).optional(),
});

// Desfazer um lançamento de perda: o dono desfaz qualquer perda manual; a equipe, só a própria e até 30 min depois.
export const LOSS_UNDO_STAFF_MINUTES = 30;
// Alerta de perda alta no lucro: perdas acima deste % do faturamento do período.
export const LOSS_ALERT_PERCENT = 5;
// Validade: "vence logo" = até este número de dias.
export const EXPIRY_SOON_DAYS = 3;