import { formatCents } from "@/shared/format/money";

// Estoque e lucro (contrato de /api/stock/*). Quantidades em UNIDADE BASE inteira (g, ml, un); dinheiro em centavos.
// Campos de custo só chegam para o DONO (a equipe recebe quantidades).

export type StockUnit = "G" | "ML" | "UN";
export type StockMovementType = "PURCHASE" | "SALE" | "SALE_REVERSAL" | "WASTE" | "SPOILAGE" | "ADJUSTMENT";

export type Ingredient = {
  id: string;
  name: string;
  unit: StockUnit;
  stockQty: number;
  minStockQty: number | null;
  active: boolean;
  lowStock: boolean;
  negative: boolean;
  unitCostMillicents?: number;
  stockValueCents?: number;
  // Validade estimada por PEPS (lote em uso). null = sem validade informada ou sem saldo.
  nextExpiresOn?: string | null;
  expiry?: "EXPIRED" | "SOON" | "OK" | null;
};

export type IngredientList = { ingredients: Ingredient[]; alerts: { lowStock: number; negative: number; expired?: number; expiringSoon?: number }; stockValueCents?: number };

export type StockMovement = {
  id: string;
  type: StockMovementType;
  quantity: number;
  reason: string | null;
  orderId: string | null;
  createdAt: string;
  ingredient: { id: string; name: string; unit: StockUnit };
  unitCostMillicents?: number;
  costCents?: number;
  userEmail?: string | null;
  note?: string | null;
  groupId?: string | null;
  reversalOfId?: string | null;
  undone?: boolean;
  canUndo?: boolean;
  expiresOn?: string | null;
};

export type RecipeLine = { ingredientId: string; name: string; unit: StockUnit; quantity: number; costCents?: number };
export type Recipe = { items: RecipeLine[]; costCents?: number; perKilo?: boolean };

export type MenuMargin = {
  id: string; name: string; priceCents: number; perKilo: boolean; hasRecipe: boolean;
  costCents: number; marginCents: number; marginPercent: number | null; costPercent: number | null;
};

export type ProfitReport = {
  fromDate: string; toDate: string; timeZone: string;
  revenueCents: number; orderCount: number;
  cogsCents: number; cogsPercent: number | null;
  grossProfitCents: number; grossMarginPercent: number | null;
  losses: { wasteCents: number; spoilageCents: number; adjustmentCents: number; totalCents: number; percentOfRevenue: number | null };
  resultAfterLossesCents: number;
  lossAlert?: { thresholdPercent: number; exceeded: boolean };
  lossesByUser?: { userId: string | null; email: string | null; count: number; costCents: number }[];
  purchasesCents: number;
  lossesByReason: { type: string; reason: string; count: number; costCents: number }[];
  topWastedIngredients: { id: string; name: string; unit: StockUnit; quantity: number; costCents: number }[];
  products: { productName: string; quantity: number; revenueCents: number; cogsCents: number; profitCents: number; marginPercent: number | null; hasCost: boolean }[];
};

export const WASTE_REASONS = { PREPARO: "Sobra do preparo", QUEIMOU: "Queimou", CAIU: "Caiu / derramou", ERRO_PEDIDO: "Erro no pedido", DEVOLUCAO_CLIENTE: "Devolução do cliente", AMOSTRA: "Amostra / degustação", OUTRO: "Outro" } as const;
export const SPOILAGE_REASONS = { VENCIDO: "Venceu", ESTRAGOU: "Estragou", ARMAZENAMENTO: "Armazenamento", OUTRO: "Outro" } as const;
// Motivo só do sistema: pedido aceito, já preparado, cancelado (os insumos viram desperdício em vez de voltar ao estoque).
export const SYSTEM_WASTE_REASONS = { PEDIDO_CANCELADO: "Pedido cancelado já preparado" } as const;
export const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  PURCHASE: "Compra", SALE: "Venda", SALE_REVERSAL: "Estorno de venda", WASTE: "Desperdício", SPOILAGE: "Estragado/vencido", ADJUSTMENT: "Ajuste de contagem",
};
export const LOSS_NOTE_MAX = 200;
export const UNIT_LABEL: Record<StockUnit, string> = { G: "g", ML: "ml", UN: "un" };

/** Unidade "grande" da tela (kg, L) para gramas e mililitros; unidade fica como está. */
export const BIG_UNIT: Record<StockUnit, { label: string; factor: number } | null> = { G: { label: "kg", factor: 1000 }, ML: { label: "L", factor: 1000 }, UN: null };

/** 1250 g -> "1,25 kg"; 300 g -> "300 g"; 12 un -> "12 un". */
export function formatQty(quantity: number, unit: StockUnit): string {
  const big = BIG_UNIT[unit];
  const abs = Math.abs(quantity);
  if (big && abs >= big.factor) return `${(quantity / big.factor).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${big.label}`;
  return `${quantity.toLocaleString("pt-BR")} ${UNIT_LABEL[unit]}`;
}

/** Custo por unidade "grande" (R$/kg, R$/L, R$/un) a partir de milésimos de centavo por unidade base. */
export function unitCostLabel(unitCostMillicents: number, unit: StockUnit): string {
  const big = BIG_UNIT[unit];
  const cents = Math.round((unitCostMillicents * (big?.factor ?? 1)) / 1000);
  return `${formatCents(cents)}/${big?.label ?? "un"}`; // moeda só por shared/format/money (catraca de fonte única)
}
