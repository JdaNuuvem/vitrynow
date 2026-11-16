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
export type AdditionalData = { id?: string; name: string; priceCents: number };

// Tudo que o catálogo precisa do armazenamento. O serviço só conhece esta interface.
export interface CatalogRepository {
  listCategories(storeId: string): Promise<CategoryWithProducts[]>;
  findCategory(storeId: string, id: string): Promise<Category | null>;
  createCategory(storeId: string, data: CategoryData & { name: string }): Promise<Category>;
  updateCategory(id: string, data: CategoryData): Promise<Category>;
  countProductsInCategory(categoryId: string): Promise<number>;
  deleteCategory(id: string): Promise<void>;

  findProduct(storeId: string, id: string): Promise<Product | null>;
  createProduct(storeId: string, data: ProductData & { name: string; priceCents: number }, additionals?: AdditionalData[]): Promise<ProductWithAdditionals>;
  updateProduct(id: string, data: ProductData, additionals?: AdditionalData[]): Promise<ProductWithAdditionals>;
  deleteProduct(id: string): Promise<void>;
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
            await tx.productAdditional.update({
              where: { id: additional.id },
              data: { name: additional.name, priceCents: additional.priceCents },
            });
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
}
