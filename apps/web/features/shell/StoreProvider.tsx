"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Category } from "@/core/domain/catalog";
import type { StoreSettings } from "@/core/domain/store";
import { usePanelServices } from "@/core/services/PanelServices";
import { setActiveStoreTimezone } from "@/shared/format/storeTime";

type StoreActions = {
  // Liga/desliga o recebimento de pedidos. Devolve a mensagem de erro, ou null se deu certo.
  setAcceptingOrders: (accepting: boolean) => Promise<string | null>;
  publishCatalog: (categories: Category[]) => void;
  publishStoreSettings: (settings: StoreSettings) => void;
  refreshCatalog: () => Promise<void>;
};

const StoreContext = createContext<StoreSettings | null>(null);
const StoreActionsContext = createContext<StoreActions | null>(null);
type CatalogSnapshot = { categories: Category[] | null; error: string | null };
const CatalogContext = createContext<CatalogSnapshot>({ categories: null, error: null });

export function useStore(): StoreSettings | null {
  return useContext(StoreContext);
}

// true/false quando já se sabe se a loja tem produto; null enquanto carrega (ou se a consulta falhou).
export function useHasProducts(): boolean | null {
  const { categories } = useStoreCatalog();
  return categories?.some((category) => category.products.length > 0) ?? null;
}

export function useStoreCatalog() {
  return useContext(CatalogContext);
}

export function useStoreActions(): StoreActions {
  const actions = useContext(StoreActionsContext);
  if (!actions) throw new Error("useStoreActions precisa estar dentro de <StoreProvider>");
  return actions;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { store: storeGateway, catalog } = usePanelServices();
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [inventory, setInventory] = useState<CatalogSnapshot>({ categories: null, error: null });
  const catalogVersion = useRef(0);
  const settingsVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const request = settingsVersion.current;
    storeGateway.getSettings().then((result) => {
      if (cancelled || request !== settingsVersion.current) return;
      if (result.ok) {
        setActiveStoreTimezone(result.data.timezone); // SSOT D1: formatadores fora de componente usam o fuso da loja
        setStore(result.data);
      }
      else if (result.status === 401) router.push("/login");
    });
    return () => {
      cancelled = true;
    };
  }, [storeGateway, router]);

  const publishCatalog = useCallback((categories: Category[]) => {
    catalogVersion.current += 1;
    setInventory({ categories, error: null });
  }, []);

  const refreshCatalog = useCallback(async () => {
    const version = ++catalogVersion.current;
    try {
      const result = await catalog.listCategories();
      if (version !== catalogVersion.current) return;
      setInventory(result.ok
        ? { categories: result.data.categories, error: null }
        : { categories: null, error: result.error || "Não foi possível consultar o catálogo." });
    } catch {
      if (version === catalogVersion.current) setInventory({ categories: null, error: "Não foi possível consultar o catálogo." });
    }
  }, [catalog]);

  useEffect(() => {
    void refreshCatalog();
    return () => { catalogVersion.current += 1; };
  }, [refreshCatalog]);

  const setAcceptingOrders = useCallback(
    async (accepting: boolean): Promise<string | null> => {
      setStore((current) => (current ? { ...current, acceptingOrders: accepting } : current));
      const result = await storeGateway.setAvailability(accepting);
      if (result.ok) return null;
      setStore((current) => (current ? { ...current, acceptingOrders: !accepting } : current));
      return result.error;
    },
    [storeGateway],
  );

  const publishStoreSettings = useCallback((settings: StoreSettings) => {
    settingsVersion.current += 1;
    setActiveStoreTimezone(settings.timezone);
    setStore((current) => ({
      ...settings,
      acceptingOrders: current?.acceptingOrders ?? settings.acceptingOrders,
    }));
  }, []);

  const actions = useMemo(
    () => ({ setAcceptingOrders, publishCatalog, refreshCatalog, publishStoreSettings }),
    [setAcceptingOrders, publishCatalog, refreshCatalog, publishStoreSettings],
  );

  return (
    <StoreActionsContext.Provider value={actions}>
      <StoreContext.Provider value={store}>
        <CatalogContext.Provider value={inventory}>{children}</CatalogContext.Provider>
      </StoreContext.Provider>
    </StoreActionsContext.Provider>
  );
}
