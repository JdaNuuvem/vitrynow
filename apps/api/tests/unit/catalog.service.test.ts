import { describe, expect, it } from "vitest";
import type { Category, Product } from "@meucardapio/db";
import type { CatalogRepository } from "../../src/modules/catalog/catalog.repository";
import { CatalogService } from "../../src/modules/catalog/catalog.service";
import { ConflictError, NotFoundError } from "../../src/shared/errors";
import { FakeAudit, actor, rec } from "./fakes";

function setup(opts: { categories?: Category[]; products?: Product[]; productsInCategory?: number } = {}) {
  const calls: string[] = [];
  const updates: unknown[] = [];
  const repo = {
    findCategory: async (storeId: string, id: string) =>
      (opts.categories ?? []).find((c) => c.id === id && c.storeId === storeId) ?? null,
    findProduct: async (storeId: string, id: string) =>
      (opts.products ?? []).find((p) => p.id === id && p.storeId === storeId) ?? null,
    countProductsInCategory: async () => opts.productsInCategory ?? 0,
    deleteCategory: async (id: string) => void calls.push(`deleteCategory:${id}`),
    deleteProduct: async (id: string) => void calls.push(`deleteProduct:${id}`),
    createCategory: async (_s: string, data: unknown) => (updates.push(data), rec<Category>({})),
    updateCategory: async (_id: string, data: unknown) => (updates.push(data), rec<Category>({})),
  } as unknown as CatalogRepository;
  const audit = new FakeAudit();
  return { service: new CatalogService(repo, audit), audit, calls, updates };
}

const category = rec<Category>({ id: "cat-1", storeId: "store-1", name: "Lanches" });
const product = rec<Product>({ id: "prod-1", storeId: "store-1", name: "X-Bacon" });

describe("CatalogService", () => {
  it("não exclui categoria que ainda tem produtos (409) e não audita", async () => {
    const { service, audit, calls } = setup({ categories: [category], productsInCategory: 3 });
    await expect(service.deleteCategory(actor, "cat-1")).rejects.toThrow(ConflictError);
    await expect(service.deleteCategory(actor, "cat-1")).rejects.toThrow("categoria tem 3 produto(s)");
    expect(calls).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("exclui categoria vazia e registra a auditoria", async () => {
    const { service, audit, calls } = setup({ categories: [category] });
    await service.deleteCategory(actor, "cat-1");
    expect(calls).toEqual(["deleteCategory:cat-1"]);
    expect(audit.entries[0]).toMatchObject({ action: "category.delete", targetId: "cat-1", storeId: "store-1", userId: "user-1" });
  });

  it("categoria de outra loja é 404, nunca excluída", async () => {
    const { service, calls } = setup({ categories: [category] });
    await expect(service.deleteCategory({ storeId: "store-2", userId: "u" }, "cat-1")).rejects.toThrow(NotFoundError);
    expect(calls).toEqual([]);
  });

  it("emoji vazio limpa o ícone; ausente não mexe nele", async () => {
    const { service, updates } = setup({ categories: [category] });
    await service.updateCategory("store-1", "cat-1", { icon: "" });
    await service.updateCategory("store-1", "cat-1", { name: "Novo" });
    expect(updates[0]).toMatchObject({ icon: null });
    expect((updates[1] as { icon?: unknown }).icon).toBeUndefined();
  });

  it("criar categoria sem emoji grava null", async () => {
    const { service, updates } = setup();
    await service.createCategory("store-1", { name: "Bebidas" });
    expect(updates[0]).toMatchObject({ name: "Bebidas", icon: null });
  });

  it("excluir produto audita com o nome", async () => {
    const { service, audit, calls } = setup({ products: [product] });
    await service.deleteProduct(actor, "prod-1");
    expect(calls).toEqual(["deleteProduct:prod-1"]);
    expect(audit.entries[0]).toMatchObject({ action: "product.delete", metadata: { name: "X-Bacon" } });
  });

  it("editar produto inexistente é 404", async () => {
    const { service } = setup();
    await expect(service.updateProduct("store-1", "nada", { name: "x" })).rejects.toThrow("produto não encontrado");
  });
});
