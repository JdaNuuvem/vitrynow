import { useCallback, useEffect, useRef, useState } from "react";
import type { Menu } from "@/core/domain/storefront";
import { useStorefrontServices } from "@/core/services/StorefrontServices";

const MENU_LOAD_ERROR = "Não foi possível carregar o cardápio. Tente novamente.";

// `initialMenu` vem do servidor (SSR): já está na tela, então não busca de novo ao montar
// (ADR-0013). Sem ele (API fora do ar na renderização), busca como antes.
export function useMenu(slug: string, initialMenu?: Menu) {
  const { storefront } = useStorefrontServices();
  const [menu, setMenu] = useState<Menu | null>(initialMenu ?? null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialMenu);
  const requestId = useRef(0);

  // STORE_CLOSED no envio do pedido já confirma o estado real da loja, mesmo se a rebusca falhar.
  const markClosedByServer = useCallback(() => {
    setMenu((current) => current && current.store.acceptingOrders !== false
      ? { ...current, store: { ...current.store, acceptingOrders: false } }
      : current);
  }, []);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const result = await storefront.getMenu(slug);
      if (currentRequest !== requestId.current) return;
      if (result.ok) setMenu(result.data);
      else if (result.status === 404) setNotFound(true);
      else setError(MENU_LOAD_ERROR);
    } catch {
      if (currentRequest === requestId.current) setError(MENU_LOAD_ERROR);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [storefront, slug]);

  useEffect(() => {
    if (!initialMenu) void load();
    // Ignora respostas antigas após desmontar, trocar de loja ou iniciar um refresh.
    return () => { requestId.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só a decisão inicial importa
  }, [load]);

  // Rebusca o cardápio (ex.: a loja fechou pra pedidos enquanto o cliente montava o carrinho).
  return { menu, notFound, error, loading, refresh: load, markClosedByServer };
}
