import type { CreateCategoryInput, CreateProductInput, UpdateProductInput } from "@meucardapio/shared-types";
import type { Actor, AuditLogger } from "../../shared/audit";
import { ConflictError, NotFoundError } from "../../shared/errors";
import type { CatalogRepository } from "./catalog.repository";

// Regras do catálogo (categorias, produtos, adicionais). Não conhece HTTP nem Prisma.
export class CatalogService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly audit: AuditLogger,
  ) {}

  listCategories(storeId: string) {
    return this.repo.listCategories(storeId);
  }

  createCategory(storeId: string, input: CreateCategoryInput) {
    const { icon, ...rest } = input;
    return this.repo.createCategory(storeId, { ...rest, icon: icon || null });
  }

  async updateCategory(storeId: string, id: string, input: Partial<CreateCategoryInput>) {
    await this.requireCategory(storeId, id);
    const { icon, ...rest } = input;
    // icon vazio limpa o emoji; ausente não mexe nele.
    return this.repo.updateCategory(id, { ...rest, icon: icon === "" ? null : icon });
  }

  async deleteCategory(actor: Actor, id: string) {
    await this.requireCategory(actor.storeId, id);
    const productCount = await this.repo.countProductsInCategory(id);
    if (productCount > 0) {
      throw new ConflictError(
        `categoria tem ${productCount} produto(s) — mova ou exclua os produtos antes de excluir a categoria`,
      );
    }
    await this.repo.deleteCategory(id);
    this.audit.log({ ...actor, action: "category.delete", targetType: "Category", targetId: id });
  }

  createProduct(storeId: string, input: CreateProductInput) {
    const { additionals, ...data } = input;
    return this.repo.createProduct(storeId, data, additionals);
  }

  async updateProduct(storeId: string, id: string, input: UpdateProductInput) {
    await this.requireProduct(storeId, id);
    const { additionals, ...data } = input;
    return this.repo.updateProduct(id, data, additionals);
  }

  async deleteProduct(actor: Actor, id: string) {
    const product = await this.requireProduct(actor.storeId, id);
    await this.repo.deleteProduct(id);
    this.audit.log({ ...actor, action: "product.delete", targetType: "Product", targetId: id, metadata: { name: product.name } });
  }

  private async requireCategory(storeId: string, id: string) {
    const category = await this.repo.findCategory(storeId, id);
    if (!category) throw new NotFoundError("categoria não encontrada");
    return category;
  }

  private async requireProduct(storeId: string, id: string) {
    const product = await this.repo.findProduct(storeId, id);
    if (!product) throw new NotFoundError("produto não encontrado");
    return product;
  }
}
