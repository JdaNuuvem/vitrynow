import type { CreateCategoryInput, CreateProductInput, SetSoldOutInput, UpdateProductInput } from "@meucardapio/shared-types";
import { nextSoldOutReset } from "../../lib/soldOut";
import { storeTimeZone } from "../../lib/storeTz";
import type { Actor, AuditLogger } from "../../shared/audit";
import { CodedError, NotFoundError } from "../../shared/errors";
import { AdditionalNotInProductError, type CatalogRepository } from "./catalog.repository";

// Limites padrão do catálogo (RN-CT-01, RN-CT-16). Ao atingir, mensagem clara e nada é apagado.
export const MAX_CATEGORIES_PER_STORE = 50;
export const MAX_PRODUCTS_PER_STORE = 500;

// Nome de categoria único na loja, sem diferenciar maiúsculas nem acentos (RN-CT-01, CA-CT-02).
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Regras do catálogo (categorias, produtos, adicionais). Não conhece HTTP nem Prisma.
export class CatalogService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly audit: AuditLogger,
  ) {}

  listCategories(storeId: string) {
    return this.repo.listCategories(storeId);
  }

  async createCategory(storeId: string, input: CreateCategoryInput) {
    const names = await this.repo.listCategoryNames(storeId);
    if (names.length >= MAX_CATEGORIES_PER_STORE) {
      throw new CodedError(409, "CATEGORY_LIMIT_REACHED", `A loja já tem ${MAX_CATEGORIES_PER_STORE} categorias (o máximo).`, { max: MAX_CATEGORIES_PER_STORE });
    }
    this.assertNameFree(names, input.name);
    const { icon, ...rest } = input;
    // Categoria nova entra no FIM da ordem (RN-CT-02), a menos que a posição venha explícita.
    const position = rest.position ?? (await this.repo.nextCategoryPosition(storeId));
    return this.repo.createCategory(storeId, { ...rest, position, icon: icon || null });
  }

  async updateCategory(storeId: string, id: string, input: Partial<CreateCategoryInput>) {
    await this.requireCategory(storeId, id);
    if (input.name !== undefined) this.assertNameFree(await this.repo.listCategoryNames(storeId), input.name, id);
    const { icon, ...rest } = input;
    // icon vazio limpa o emoji; ausente não mexe nele.
    return this.repo.updateCategory(id, { ...rest, icon: icon === "" ? null : icon });
  }

  async deleteCategory(actor: Actor, id: string) {
    const category = await this.requireCategory(actor.storeId, id);
    const productCount = await this.repo.countProductsInCategory(id);
    if (productCount > 0) {
      // RN-CT-04: só sai categoria sem nenhum produto (visível, oculto ou esgotado); a saída é "Mover produtos para…".
      throw new CodedError(
        409,
        "CATEGORY_NOT_EMPTY",
        `categoria tem ${productCount} produto(s) — mova ou exclua os produtos antes de excluir a categoria`,
        { count: productCount, hint: "MOVE_PRODUCTS" },
      );
    }
    await this.repo.deleteCategory(id);
    this.audit.log({ ...actor, action: "category.delete", targetType: "Category", targetId: id, metadata: { name: category.name } });
  }

  // "Mover produtos para…" (RN-CT-04): vale na hora; o histórico dos pedidos não muda.
  async moveProducts(actor: Actor, fromId: string, toId: string) {
    if (fromId === toId) throw new CodedError(400, "SAME_CATEGORY", "Escolha outra categoria de destino.");
    await this.requireCategory(actor.storeId, fromId);
    await this.requireCategory(actor.storeId, toId); // SEC-11: destino tem que ser desta loja
    const moved = await this.repo.moveProducts(actor.storeId, fromId, toId);
    this.audit.log({ ...actor, action: "category.move_products", targetType: "Category", targetId: fromId, metadata: { toCategoryId: toId, moved } });
    return { moved };
  }

  // Reordenar (RN-CT-02): a ordem enviada vira a posição. Ids de outra loja nunca são tocados.
  async reorderCategories(storeId: string, ids: string[]) {
    await this.assertAllOwned(ids, (await this.repo.listCategoryIds(storeId)));
    await this.repo.setCategoryOrder(storeId, ids);
  }

  async reorderProducts(storeId: string, categoryId: string, ids: string[]) {
    await this.requireCategory(storeId, categoryId);
    await this.assertAllOwned(ids, await this.repo.listProductIds(storeId, categoryId));
    await this.repo.setProductOrder(storeId, categoryId, ids);
  }

  async createProduct(storeId: string, input: CreateProductInput) {
    const { additionals, ...data } = input;
    // SEC-11: categoryId vem do cliente; categoria de outra loja injetaria o produto no cardápio dela.
    await this.requireCategory(storeId, data.categoryId);
    if ((await this.repo.countProducts(storeId)) >= MAX_PRODUCTS_PER_STORE) {
      throw new CodedError(409, "PRODUCT_LIMIT_REACHED", `A loja já tem ${MAX_PRODUCTS_PER_STORE} produtos (o máximo).`, { max: MAX_PRODUCTS_PER_STORE });
    }
    // Produto novo entra no FIM da categoria (RN-CT-02).
    const position = data.position ?? (await this.repo.nextProductPosition(data.categoryId));
    return this.repo.createProduct(storeId, { ...data, position }, additionals);
  }

  async updateProduct(actor: Actor, id: string, input: UpdateProductInput) {
    const before = await this.requireProduct(actor.storeId, id);
    const { additionals, ...data } = input;
    if (data.categoryId) await this.requireCategory(actor.storeId, data.categoryId);
    let product;
    try {
      product = await this.repo.updateProduct(id, data, additionals);
    } catch (error) {
      // SEC-10: adicional que não é deste produto (inclusive de outra loja) => 404, nada alterado.
      if (error instanceof AdditionalNotInProductError) throw new NotFoundError("adicional não encontrado neste produto");
      throw error;
    }
    // RN-CT-13: toda mudança de preço grava auditoria com valor antes e depois.
    if (data.priceCents !== undefined && data.priceCents !== before.priceCents) {
      this.audit.log({
        ...actor,
        action: "product.price_change",
        targetType: "Product",
        targetId: id,
        metadata: { name: before.name, beforeCents: before.priceCents, afterCents: data.priceCents },
      });
    }
    return product;
  }

  // API-17: liga/desliga "esgotado". TODAY volta às 04:00 do fuso da loja; MANUAL só volta quando reativado.
  async setSoldOut(actor: Actor, id: string, input: SetSoldOutInput) {
    const product = await this.requireProduct(actor.storeId, id);
    const duration = input.duration ?? "TODAY";
    const soldOutUntil = input.soldOut && duration === "TODAY" ? nextSoldOutReset(new Date(), await storeTimeZone(actor.storeId)) : null;
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
    // RN-CT-12: com pedido em aberto a exclusão é bloqueada; a saída é ocultar (active=false).
    const openOrders = await this.repo.countOpenOrdersWithProduct(id);
    if (openOrders > 0) {
      throw new CodedError(409, "PRODUCT_IN_OPEN_ORDERS", `${product.name} está em ${openOrders} pedido(s) em aberto. Oculte em vez de excluir.`, {
        count: openOrders,
        hint: "HIDE_INSTEAD",
      });
    }
    await this.repo.deleteProduct(id);
    this.audit.log({
      ...actor,
      action: "product.delete",
      targetType: "Product",
      targetId: id,
      metadata: { name: product.name, priceCents: product.priceCents },
    });
  }

  private assertNameFree(names: Array<{ id: string; name: string }>, name: string, exceptId?: string) {
    const wanted = normalizeName(name);
    if (names.some((existing) => existing.id !== exceptId && normalizeName(existing.name) === wanted)) {
      throw new CodedError(409, "CATEGORY_NAME_TAKEN", "Já existe uma categoria com esse nome.");
    }
  }

  private assertAllOwned(ids: string[], ownedIds: string[]) {
    const owned = new Set(ownedIds);
    if (new Set(ids).size !== ids.length || ids.some((id) => !owned.has(id))) {
      throw new NotFoundError("item não encontrado na ordem enviada");
    }
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
