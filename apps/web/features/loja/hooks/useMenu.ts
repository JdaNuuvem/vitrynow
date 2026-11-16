import { useCallback, useEffect, useState } from "react";
import type { Menu } from "@/core/domain/storefront";
import { useStorefrontServices } from "@/core/services/StorefrontServices";

// `initialMenu` vem do servidor (SSR): já está na tela, então não busca de novo ao montar
// (ADR-0013). Sem ele (API fora do ar na renderização), busca como antes.
export function useMenu(slug: string, initialMenu?: Menu) {
  const { storefront } = useStorefrontServices();
  const [menu, setMenu] = useState<Menu | null>(initialMenu ?? null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const result = await storefront.getMenu(slug);
    if (result.ok) setMenu(result.data);
    else setNotFound(true);
  }, [storefront, slug]);

  useEffect(() => {
    if (initialMenu) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só a decisão inicial importa
  }, [load]);

  // Rebusca o cardápio (ex.: a loja fechou pra pedidos enquanto o cliente montava o carrinho).
  return { menu, notFound, refresh: load };
}
