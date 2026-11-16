"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Category, ProductInput } from "@/core/domain/catalog";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";

// Cada ação devolve a mensagem de erro, ou null se deu certo (e a lista já foi recarregada).
export function useCatalogo() {
  const router = useRouter();
  const { catalog } = usePanelServices();
  const [categories, setCategories] = useState<Category[]>([]);

  const reload = useCallback(async () => {
    const result = await catalog.listCategories();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return;
    }
    setCategories(result.data.categories);
  }, [catalog, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<HttpResult<unknown>>): Promise<string | null> => {
      const result = await action();
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
    createCategory: (name: string, icon: string) => run(() => catalog.createCategory({ name, icon: icon || undefined })),
    updateCategoryIcon: (id: string, icon: string) => run(() => catalog.updateCategoryIcon(id, icon)),
    deleteCategory: (id: string) => run(() => catalog.deleteCategory(id)),
    saveProduct: (input: ProductInput, productId?: string) =>
      run(() => (productId ? catalog.updateProduct(productId, input) : catalog.createProduct(input))),
    deleteProduct: (id: string) => run(() => catalog.deleteProduct(id)),
  };
}
