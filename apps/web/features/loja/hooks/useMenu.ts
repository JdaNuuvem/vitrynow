import { useCallback, useEffect, useState } from "react";
import type { Menu } from "@/core/domain/storefront";
import { useStorefrontServices } from "@/core/services/StorefrontServices";

export function useMenu(slug: string) {
  const { storefront } = useStorefrontServices();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const result = await storefront.getMenu(slug);
    if (result.ok) setMenu(result.data);
    else setNotFound(true);
  }, [storefront, slug]);

  useEffect(() => {
    load();
  }, [load]);

  // Rebusca o cardápio (ex.: a loja fechou pra pedidos enquanto o cliente montava o carrinho).
  return { menu, notFound, refresh: load };
}
