import type { HttpClient } from "../../http/HttpClient";
import type { CatalogGateway } from "../CatalogGateway";
import type { Category, ProductAvailability, ProductInput } from "../../domain/catalog";
import type { GroupChange, OptionGroup, OptionGroupInput, ProductGroups } from "../../domain/optionGroups";

export class HttpCatalogGateway implements CatalogGateway {
  constructor(private readonly http: HttpClient) {}

  listCategories() {
    return this.http.get<{ categories: Category[] }>("/api/catalog/categories");
  }

  createCategory(input: { name: string; icon?: string }) {
    return this.http.post("/api/catalog/categories", input);
  }

  updateCategory(id: string, input: { name?: string; icon?: string }) {
    return this.http.post(`/api/catalog/categories/${encodeURIComponent(id)}`, input);
  }

  reorderCategories(ids: string[]) {
    return this.http.post("/api/catalog/categories/reorder", { ids });
  }

  reorderProducts(categoryId: string, ids: string[]) {
    return this.http.post("/api/catalog/products/reorder", { categoryId, ids });
  }

  moveProducts(categoryId: string, toCategoryId: string) {
    return this.http.post<{ moved: number }>(`/api/catalog/categories/${encodeURIComponent(categoryId)}/move-products`, { toCategoryId });
  }

  deleteCategory(id: string) {
    return this.http.post(`/api/catalog/categories/${id}/delete`);
  }

  createProduct(input: ProductInput) {
    return this.http.post("/api/catalog/products", input);
  }

  updateProduct(id: string, input: ProductInput) {
    return this.http.post(`/api/catalog/products/${id}`, input);
  }

  deleteProduct(id: string) {
    return this.http.post(`/api/catalog/products/${id}/delete`);
  }

  setAvailability(id: string, availability: ProductAvailability) {
    const body = availability === "AVAILABLE" ? { soldOut: false } : { soldOut: true, duration: availability };
    return this.http.post(`/api/catalog/products/${encodeURIComponent(id)}/sold-out`, body);
  }

  listOptionGroups() {
    return this.http.get<{ groups: OptionGroup[] }>("/api/catalog/option-groups");
  }

  saveOptionGroup(input: OptionGroupInput, id?: string) {
    const path = id ? `/api/catalog/option-groups/${encodeURIComponent(id)}` : "/api/catalog/option-groups";
    return this.http.post<GroupChange>(path, input);
  }

  deleteOptionGroup(id: string) {
    return this.http.post<{ ok: true; usedIn: number }>(`/api/catalog/option-groups/${encodeURIComponent(id)}/delete`);
  }

  listProductGroups(productId: string) {
    return this.http.get<ProductGroups>(`/api/catalog/products/${encodeURIComponent(productId)}/option-groups`);
  }

  setProductGroups(productId: string, groupIds: string[]) {
    return this.http.post<ProductGroups>(`/api/catalog/products/${encodeURIComponent(productId)}/option-groups`, { groupIds });
  }
}
