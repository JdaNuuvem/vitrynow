"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IngredientList } from "@/core/domain/stock";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";

// Estado da tela de estoque: lista de insumos (com alertas) e as ações que mudam o saldo. Recarrega sozinho quando o
// servidor avisa que um insumo cruzou o mínimo (`stock.low`) ou quando um pedido muda (a venda dá baixa ao aceitar).
export function useEstoque() {
  const router = useRouter();
  const { stock, realtime } = usePanelServices();
  const [data, setData] = useState<IngredientList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const current = ++version.current;
    setError(null);
    const result = await stock.list();
    if (current !== version.current) return;
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      setError(result.error);
      return;
    }
    setData(result.data);
  }, [stock, router]);

  useEffect(() => {
    void reload();
    const stop = realtime.subscribe((event) => {
      if (event?.type === "stock.low" || event?.type === "order.updated" || event?.type === "order.created") void reload();
    });
    return () => {
      version.current += 1;
      stop();
    };
  }, [reload, realtime]);

  /** Roda a ação, recarrega a lista e devolve a mensagem de erro (ou null). */
  async function run(action: () => Promise<HttpResult<unknown>>): Promise<string | null> {
    const result = await action();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return result.error;
    }
    await reload();
    return null;
  }

  return { data, error, reload, run, gateway: stock };
}
