"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryQuery, HistoryRow } from "@/core/domain/orderHistory";
import { usePanelServices } from "@/core/services/PanelServices";

export type HistoryLoadState = "loading" | "ready" | "error";

const PAGE_SIZE = 25;

// Lista do histórico com cursor (RN-HP-03: "Carregar mais", sem rolagem infinita). `query` sem cursor/limit; muda ⇒ recarrega do começo.
export function useOrderHistoryList(query: HistoryQuery) {
  const router = useRouter();
  const { orders: gateway } = usePanelServices();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [timezone, setTimezone] = useState<string | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<HistoryLoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  // Descarta resposta de uma consulta que já ficou velha (filtro mudou ou nova recarga começou).
  const generation = useRef(0);
  // Trava de "Carregar mais" em REF: o estado só vale no render seguinte, e dois toques no mesmo instante pediriam a página duas vezes.
  const fetchingMore = useRef(false);
  const queryKey = JSON.stringify(query);

  const load = useCallback(
    async (mode: "first" | "refresh") => {
      const mine = ++generation.current;
      fetchingMore.current = false; // uma consulta nova invalida o "carregar mais" que estivesse a caminho
      if (mode === "first") setLoadState("loading");
      const result = await gateway.history({ ...JSON.parse(queryKey), limit: PAGE_SIZE });
      if (mine !== generation.current) return;
      if (!result.ok) {
        if (result.status === 401) return router.push("/login");
        setRateLimited(result.status === 429);
        // Recarga que falha depois de já mostrar a lista mantém o que há; só a 1ª carga vira erro.
        setLoadState((current) => (mode === "refresh" && current === "ready" ? current : "error"));
        return;
      }
      setRateLimited(false);
      setRows(result.data.rows);
      setTotal(result.data.total);
      setTimezone(result.data.timezone);
      setNextCursor(result.data.nextCursor);
      setMoreFailed(false);
      setLoadState("ready");
    },
    [gateway, queryKey, router],
  );

  useEffect(() => {
    void load("first");
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || fetchingMore.current) return;
    fetchingMore.current = true;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreFailed(false);
    const result = await gateway.history({ ...JSON.parse(queryKey), limit: PAGE_SIZE, cursor: nextCursor });
    fetchingMore.current = false;
    setLoadingMore(false);
    if (mine !== generation.current) return;
    if (!result.ok) {
      if (result.status === 401) return router.push("/login");
      setRateLimited(result.status === 429);
      return setMoreFailed(true);
    }
    // Sem repetir nem pular (CA-HP-04): uma linha que já está na lista não entra de novo.
    setRows((current) => {
      const seen = new Set(current.map((row) => row.id));
      return [...current, ...result.data.rows.filter((row) => !seen.has(row.id))];
    });
    setTotal(result.data.total);
    setNextCursor(result.data.nextCursor);
  }, [gateway, nextCursor, queryKey, router]);

  // Depois de uma ação (concluir, cancelar...): busca de novo SEM trocar a lista por "carregando". Estável: serve de dependência de efeito.
  const refresh = useCallback(() => void load("refresh"), [load]);
  const retry = useCallback(() => void load("first"), [load]);

  return {
    rows,
    total,
    timezone,
    loadState,
    hasMore: nextCursor !== null,
    loadingMore,
    moreFailed,
    rateLimited,
    loadMore,
    retry,
    refresh,
  };
}
