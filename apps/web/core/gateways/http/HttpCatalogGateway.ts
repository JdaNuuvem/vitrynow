import type { HttpClient } from "../../http/HttpClient";
import type { CatalogGateway } from "../CatalogGateway";
import type { Category, ProductInput } from "../../domain/catalog";

export class HttpCatalogGateway implements CatalogGateway {
  constructor(private readonly http: HttpClient) {}

  listCategories() {
    return this.http.get<{ categories: Category[] }>("/api/catalog/categories");
  }

  createCategory(input: { name: string; icon?: string }) {
    return this.http.post("/api/catalog/categories", input);
  }

  updateCategoryIcon(id: string, icon: string) {
    return this.http.post(`/api/catalog/categories/${id}`, { icon });
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
}
