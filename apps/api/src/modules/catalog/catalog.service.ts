import type { CreateCategoryInput, CreateProductInput, SetSoldOutInput, UpdateProductInput } from "@meucardapio/shared-types";
import { nextSoldOutReset } from "../../lib/soldOut";
import type { Actor, AuditLogger } from "../../shared/audit";
import { ConflictError, NotFoundError } from "../../shared/errors";
import { AdditionalNotInProductError, type CatalogRepository } from "./catalog.repository";

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

  async createProduct(storeId: string, input: CreateProductInput) {
    const { additionals, ...data } = input;
    // SEC-11: categoryId vem do cliente; categoria de outra loja injetaria o produto no cardápio dela.
    if (data.categoryId) await this.requireCategory(storeId, data.categoryId);
    return this.repo.createProduct(storeId, data, additionals);
  }

  async updateProduct(storeId: string, id: string, input: UpdateProductInput) {
    await this.requireProduct(storeId, id);
    const { additionals, ...data } = input;
    if (data.categoryId) await this.requireCategory(storeId, data.categoryId);
    try {
      return await this.repo.updateProduct(id, data, additionals);
    } catch (error) {
      // SEC-10: adicional que não é deste produto (inclusive de outra loja) => 404, nada alterado.
      if (error instanceof AdditionalNotInProductError) throw new NotFoundError("adicional não encontrado neste produto");
      throw error;
    }
  }

  // API-17: liga/desliga "esgotado". TODAY volta às 04:00 do fuso da loja; MANUAL só volta quando reativado.
  async setSoldOut(actor: Actor, id: string, input: SetSoldOutInput) {
    const product = await this.requireProduct(actor.storeId, id);
    const duration = input.duration ?? "TODAY";
    const soldOutUntil = input.soldOut && duration === "TODAY" ? nextSoldOutReset() : null;
    const updated = await this.repo.updateProduct(id, { soldOut: input.soldOut, soldOutUntil });
    this.audit.log({
      ...actor,
      action: input.soldOut ? "product.sold_out" : "product.sold_out_cleared",
      targetType: "Product",
      targetId: id,
      metadata: { name: product.name, duration: input.soldOut ? duration : null, until: soldOutUntil },
    });
    return updated;
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
