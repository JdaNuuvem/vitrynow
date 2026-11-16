"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { StoreSettings } from "@/core/domain/store";
import { usePanelServices } from "@/core/services/PanelServices";

type StoreActions = {
  // Liga/desliga o recebimento de pedidos. Devolve a mensagem de erro, ou null se deu certo.
  setAcceptingOrders: (accepting: boolean) => Promise<string | null>;
};

const StoreContext = createContext<StoreSettings | null>(null);
const StoreActionsContext = createContext<StoreActions | null>(null);

export function useStore(): StoreSettings | null {
  return useContext(StoreContext);
}

export function useStoreActions(): StoreActions {
  const actions = useContext(StoreActionsContext);
  if (!actions) throw new Error("useStoreActions precisa estar dentro de <StoreProvider>");
  return actions;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { store: storeGateway } = usePanelServices();
  const [store, setStore] = useState<StoreSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    storeGateway.getSettings().then((result) => {
      if (cancelled) return;
      if (result.ok) setStore(result.data);
      else if (result.status === 401) router.push("/login");
    });
    return () => {
      cancelled = true;
    };
  }, [storeGateway, router]);

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

  const actions = useMemo(() => ({ setAcceptingOrders }), [setAcceptingOrders]);

  return (
    <StoreActionsContext.Provider value={actions}>
      <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
    </StoreActionsContext.Provider>
  );
}
