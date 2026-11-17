import type { Category, Product, ProductAdditional, prisma as prismaClient } from "@meucardapio/db";

type Db = typeof prismaClient;

export type ProductWithAdditionals = Product & { additionals: ProductAdditional[] };
export type CategoryWithProducts = Category & { products: ProductWithAdditionals[] };

export type CategoryData = { name?: string; position?: number; icon?: string | null };
export type ProductData = {
  categoryId?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  priceCents?: number;
  active?: boolean;
  featured?: boolean;
  position?: number;
};
// Adicional informado que não pertence ao produto (id de outro produto/loja ou inexistente).
export class AdditionalNotInProductError extends Error {
  constructor(readonly additionalId: string) {
    super("adicional não pertence ao produto");
    this.name = "AdditionalNotInProductError";
  }
}

export type AdditionalData = { id?: string; name: string; priceCents: number };

// Tudo que o catálogo precisa do armazenamento. O serviço só conhece esta interface.
export interface CatalogRepository {
  listCategories(storeId: string): Promise<CategoryWithProducts[]>;
  findCategory(storeId: string, id: string): Promise<Category | null>;
  createCategory(storeId: string, data: CategoryData & { name: string }): Promise<Category>;
  updateCategory(id: string, data: CategoryData): Promise<Category>;
  countProductsInCategory(categoryId: string): Promise<number>;
  deleteCategory(id: string): Promise<void>;
  listCategoryNames(storeId: string): Promise<Array<{ id: string; name: string }>>;
  listCategoryIds(storeId: string): Promise<string[]>;
  nextCategoryPosition(storeId: string): Promise<number>;
  setCategoryOrder(storeId: string, ids: string[]): Promise<void>;
  moveProducts(storeId: string, fromCategoryId: string, toCategoryId: string): Promise<number>;

  findProduct(storeId: string, id: string): Promise<Product | null>;
  createProduct(storeId: string, data: ProductData & { name: string; priceCents: number }, additionals?: AdditionalData[]): Promise<ProductWithAdditionals>;
  updateProduct(id: string, data: ProductData, additionals?: AdditionalData[]): Promise<ProductWithAdditionals>;
  deleteProduct(id: string): Promise<void>;
  countProducts(storeId: string): Promise<number>;
  listProductIds(storeId: string, categoryId: string): Promise<string[]>;
  nextProductPosition(categoryId: string): Promise<number>;
  setProductOrder(storeId: string, categoryId: string, ids: string[]): Promise<void>;
  /** Pedidos ainda em aberto (não concluídos nem cancelados) que têm o produto. */
  countOpenOrdersWithProduct(productId: string): Promise<number>;
}

export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly db: Db) {}

  listCategories(storeId: string) {
    return this.db.category.findMany({
      where: { storeId },
      orderBy: { position: "asc" },
      include: { products: { orderBy: { position: "asc" }, include: { additionals: true } } },
    });
  }

  findCategory(storeId: string, id: string) {
    return this.db.category.findFirst({ where: { id, storeId } });
  }

  createCategory(storeId: string, data: CategoryData & { name: string }) {
    return this.db.category.create({ data: { storeId, ...data } });
  }

  updateCategory(id: string, data: CategoryData) {
    return this.db.category.update({ where: { id }, data });
  }

  countProductsInCategory(categoryId: string) {
    return this.db.product.count({ where: { categoryId } });
  }

  async deleteCategory(id: string) {
    await this.db.category.delete({ where: { id } });
  }

  listCategoryNames(storeId: string) {
    return this.db.category.findMany({ where: { storeId }, select: { id: true, name: true } });
  }

  async listCategoryIds(storeId: string) {
    return (await this.db.category.findMany({ where: { storeId }, select: { id: true } })).map((c) => c.id);
  }

  async nextCategoryPosition(storeId: string) {
    const last = await this.db.category.aggregate({ where: { storeId }, _max: { position: true } });
    return (last._max.position ?? -1) + 1;
  }

  async setCategoryOrder(storeId: string, ids: string[]) {
    await this.db.$transaction(ids.map((id, position) => this.db.category.updateMany({ where: { id, storeId }, data: { position } })));
  }

  async moveProducts(storeId: string, fromCategoryId: string, toCategoryId: string) {
    // Os movidos entram no fim da categoria de destino, mantendo a ordem relativa.
    return this.db.$transaction(async (tx) => {
      const last = await tx.product.aggregate({ where: { categoryId: toCategoryId }, _max: { position: true } });
      const moving = await tx.product.findMany({ where: { storeId, categoryId: fromCategoryId }, orderBy: { position: "asc" }, select: { id: true } });
      let position = (last._max.position ?? -1) + 1;
      for (const { id } of moving) await tx.product.update({ where: { id }, data: { categoryId: toCategoryId, position: position++ } });
      return moving.length;
    });
  }

  findProduct(storeId: string, id: string) {
    return this.db.product.findFirst({ where: { id, storeId } });
  }

  createProduct(storeId: string, data: ProductData & { name: string; priceCents: number }, additionals?: AdditionalData[]) {
    return this.db.product.create({
      data: {
        ...data,
        storeId,
        additionals: additionals ? { create: additionals.map(({ name, priceCents }) => ({ name, priceCents })) } : undefined,
      },
      include: { additionals: true },
    });
  }

  // Produto e adicionais mudam juntos: tudo na mesma transação.
  updateProduct(id: string, data: ProductData, additionals?: AdditionalData[]) {
    return this.db.$transaction(async (tx) => {
      if (additionals) {
        const keepIds = additionals.filter((a) => a.id).map((a) => a.id as string);
        await tx.productAdditional.deleteMany({ where: { productId: id, id: { notIn: keepIds } } });
        for (const additional of additionals) {
          if (additional.id) {
            // SEC-10: o id vem do cliente e é público no cardápio; só vale se o adicional é DESTE
            // produto (que já foi conferido como da loja). Senão aborta e desfaz a transação.
            const result = await tx.productAdditional.updateMany({
              where: { id: additional.id, productId: id },
              data: { name: additional.name, priceCents: additional.priceCents },
            });
            if (result.count !== 1) throw new AdditionalNotInProductError(additional.id);
          } else {
            await tx.productAdditional.create({
              data: { productId: id, name: additional.name, priceCents: additional.priceCents },
            });
          }
        }
      }
      return tx.product.update({ where: { id }, data, include: { additionals: true } });
    });
  }

  async deleteProduct(id: string) {
    await this.db.product.delete({ where: { id } });
  }

  countProducts(storeId: string) {
    return this.db.product.count({ where: { storeId } });
  }

  async listProductIds(storeId: string, categoryId: string) {
    return (await this.db.product.findMany({ where: { storeId, categoryId }, select: { id: true } })).map((p) => p.id);
  }

  async nextProductPosition(categoryId: string) {
    const last = await this.db.product.aggregate({ where: { categoryId }, _max: { position: true } });
    return (last._max.position ?? -1) + 1;
  }

  async setProductOrder(storeId: string, categoryId: string, ids: string[]) {
    await this.db.$transaction(ids.map((id, position) => this.db.product.updateMany({ where: { id, storeId, categoryId }, data: { position } })));
  }

  countOpenOrdersWithProduct(productId: string) {
    return this.db.order.count({
      where: { status: { notIn: ["CONCLUIDO", "CANCELADO"] }, items: { some: { productId } } },
    });
  }
}
