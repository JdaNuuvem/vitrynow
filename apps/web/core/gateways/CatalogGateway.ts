import type { HttpResult } from "../http/HttpClient";
import type { Category, ProductInput } from "../domain/catalog";

export interface CatalogGateway {
  listCategories(): Promise<HttpResult<{ categories: Category[] }>>;
  createCategory(input: { name: string; icon?: string }): Promise<HttpResult<unknown>>;
  updateCategoryIcon(id: string, icon: string): Promise<HttpResult<unknown>>;
  deleteCategory(id: string): Promise<HttpResult<unknown>>;
  createProduct(input: ProductInput): Promise<HttpResult<unknown>>;
  updateProduct(id: string, input: ProductInput): Promise<HttpResult<unknown>>;
  deleteProduct(id: string): Promise<HttpResult<unknown>>;
}
