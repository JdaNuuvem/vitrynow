import type { HttpResult } from "../http/HttpClient";
import type { Ingredient, IngredientList, MenuMargin, ProfitReport, Recipe, StockMovement, StockMovementType, StockUnit } from "../domain/stock";

export type LossInput = { type: "WASTE" | "SPOILAGE"; quantity: number; reason: string };
export type MovementsQuery = { ingredientId?: string; type?: StockMovementType; from?: string; to?: string; cursor?: string };
type IngredientReply = { ingredient: Ingredient };

export interface StockGateway {
  list(): Promise<HttpResult<IngredientList>>;
  create(input: { name: string; unit: StockUnit; minStockQty?: number | null }): Promise<HttpResult<IngredientReply>>;
  update(id: string, input: { name?: string; minStockQty?: number | null; active?: boolean }): Promise<HttpResult<IngredientReply>>;
  purchase(id: string, input: { quantity: number; totalCostCents: number }): Promise<HttpResult<IngredientReply>>;
  loss(id: string, input: LossInput): Promise<HttpResult<IngredientReply>>;
  count(id: string, countedQty: number): Promise<HttpResult<IngredientReply & { diff: number }>>;
  movements(query?: MovementsQuery): Promise<HttpResult<{ movements: StockMovement[]; nextCursor: string | null }>>;
  productRecipe(productId: string): Promise<HttpResult<Recipe>>;
  saveProductRecipe(productId: string, items: { ingredientId: string; quantity: number }[]): Promise<HttpResult<Recipe>>;
  optionRecipe(optionId: string): Promise<HttpResult<Recipe>>;
  saveOptionRecipe(optionId: string, items: { ingredientId: string; quantity: number }[]): Promise<HttpResult<Recipe>>;
  menuMargins(): Promise<HttpResult<{ products: MenuMargin[] }>>;
  profit(range: { from: string; to: string }): Promise<HttpResult<ProfitReport>>;
}
