import type { HttpResult } from "../http/HttpClient";
import type { Category, ProductAvailability, ProductInput } from "../domain/catalog";
import type { GroupChange, OptionGroup, OptionGroupInput, ProductGroups } from "../domain/optionGroups";

export interface CatalogGateway {
  listCategories(): Promise<HttpResult<{ categories: Category[] }>>;
  createCategory(input: { name: string; icon?: string }): Promise<HttpResult<unknown>>;
  updateCategory(id: string, input: { name?: string; icon?: string }): Promise<HttpResult<unknown>>;
  reorderCategories(ids: string[]): Promise<HttpResult<unknown>>;
  reorderProducts(categoryId: string, ids: string[]): Promise<HttpResult<unknown>>;
  moveProducts(categoryId: string, toCategoryId: string): Promise<HttpResult<{ moved: number }>>;
  deleteCategory(id: string): Promise<HttpResult<unknown>>;
  createProduct(input: ProductInput): Promise<HttpResult<unknown>>;
  updateProduct(id: string, input: ProductInput): Promise<HttpResult<unknown>>;
  deleteProduct(id: string): Promise<HttpResult<unknown>>;
  setAvailability(id: string, availability: ProductAvailability): Promise<HttpResult<unknown>>;
  listOptionGroups(): Promise<HttpResult<{ groups: OptionGroup[] }>>;
  saveOptionGroup(input: OptionGroupInput, id?: string): Promise<HttpResult<GroupChange>>;
  deleteOptionGroup(id: string): Promise<HttpResult<{ ok: true; usedIn: number }>>;
  listProductGroups(productId: string): Promise<HttpResult<ProductGroups>>;
  setProductGroups(productId: string, groupIds: string[]): Promise<HttpResult<ProductGroups>>;
}
