import type { HttpClient } from "../../http/HttpClient";
import type { Ingredient, IngredientList, MenuMargin, ProfitReport, Recipe, StockMovement, StockUnit } from "../../domain/stock";
import type { LossInput, MovementsQuery, StockGateway } from "../StockGateway";

const enc = encodeURIComponent;
type IngredientReply = { ingredient: Ingredient };
type RecipeItems = { ingredientId: string; quantity: number }[];

export class HttpStockGateway implements StockGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<IngredientList>("/api/stock/ingredients");
  }
  create(input: { name: string; unit: StockUnit; minStockQty?: number | null }) {
    return this.http.post<IngredientReply>("/api/stock/ingredients", input);
  }
  update(id: string, input: { name?: string; minStockQty?: number | null; active?: boolean }) {
    return this.http.patch<IngredientReply>(`/api/stock/ingredients/${enc(id)}`, input);
  }
  purchase(id: string, input: { quantity: number; totalCostCents: number }) {
    return this.http.post<IngredientReply>(`/api/stock/ingredients/${enc(id)}/purchase`, input);
  }
  loss(id: string, input: LossInput) {
    return this.http.post<IngredientReply>(`/api/stock/ingredients/${enc(id)}/loss`, input);
  }
  count(id: string, countedQty: number) {
    return this.http.post<IngredientReply & { diff: number }>(`/api/stock/ingredients/${enc(id)}/count`, { countedQty });
  }
  movements(query: MovementsQuery = {}) {
    const entries = Object.entries(query).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "");
    const qs = new URLSearchParams(entries).toString();
    return this.http.get<{ movements: StockMovement[]; nextCursor: string | null }>(`/api/stock/movements${qs ? `?${qs}` : ""}`);
  }
  productRecipe(productId: string) {
    return this.http.get<Recipe>(`/api/stock/products/${enc(productId)}/recipe`);
  }
  saveProductRecipe(productId: string, items: RecipeItems) {
    return this.http.put<Recipe>(`/api/stock/products/${enc(productId)}/recipe`, { items });
  }
  optionRecipe(optionId: string) {
    return this.http.get<Recipe>(`/api/stock/options/${enc(optionId)}/recipe`);
  }
  saveOptionRecipe(optionId: string, items: RecipeItems) {
    return this.http.put<Recipe>(`/api/stock/options/${enc(optionId)}/recipe`, { items });
  }
  menuMargins() {
    return this.http.get<{ products: MenuMargin[] }>("/api/stock/menu-margins");
  }
  profit({ from, to }: { from: string; to: string }) {
    return this.http.get<ProfitReport>(`/api/stock/profit?${new URLSearchParams({ from, to })}`);
  }
}
