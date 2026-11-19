"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Category, ProductAvailability, ProductInput } from "@/core/domain/catalog";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { useStoreActions } from "@/features/shell/StoreProvider";

// Cada ação devolve a mensagem de erro, ou null se deu certo (e a lista já foi recarregada).
export function useCatalogo() {
  const router = useRouter();
  const { catalog } = usePanelServices();
  const { publishCatalog } = useStoreActions();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    let result: Awaited<ReturnType<typeof catalog.listCategories>>;
    try {
      result = await catalog.listCategories();
    } catch {
      result = { ok: false, status: 0, error: "Não foi possível carregar o catálogo. Confira sua conexão." };
    }
    if (request !== latest.current) return;
    setLoading(false);
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      setError(result.error);
      return;
    }
    setError(null);
    setCategories(result.data.categories);
    publishCatalog(result.data.categories);
  }, [catalog, router, publishCatalog]);

  useEffect(() => {
    void reload();
    return () => { latest.current += 1; };
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<HttpResult<unknown>>): Promise<string | null> => {
      let result: HttpResult<unknown>;
      try {
        result = await action();
      } catch {
        return "Confira sua conexão e tente novamente.";
      }
      if (!result.ok) {
        if (result.status === 401) router.push("/login");
        return result.error;
      }
      await reload();
      return null;
    },
    [reload, router],
  );

  return {
    categories,
    loading,
    error,
    reload,
    createCategory: (name: string, icon: string) => run(() => catalog.createCategory({ name, icon: icon || undefined })),
    updateCategory: (id: string, input: { name?: string; icon?: string }) => run(() => catalog.updateCategory(id, input)),
    updateCategoryIcon: (id: string, icon: string) => run(() => catalog.updateCategory(id, { icon })),
    reorderCategories: (ids: string[]) => run(() => catalog.reorderCategories(ids)),
    reorderProducts: (categoryId: string, ids: string[]) => run(() => catalog.reorderProducts(categoryId, ids)),
    moveProducts: (categoryId: string, toCategoryId: string) => run(() => catalog.moveProducts(categoryId, toCategoryId)),
    deleteCategory: (id: string) => run(() => catalog.deleteCategory(id)),
    saveProduct: (input: ProductInput, productId?: string) =>
      run(() => (productId ? catalog.updateProduct(productId, input) : catalog.createProduct(input))),
    deleteProduct: (id: string) => run(() => catalog.deleteProduct(id)),
    setAvailability: (id: string, availability: ProductAvailability) => run(() => catalog.setAvailability(id, availability)),
  };
}
