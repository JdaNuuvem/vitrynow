"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { OrderDetail } from "@/core/domain/orderDetail";
import { isOrderId } from "@/core/domain/orderId";
import { usePanelServices } from "@/core/services/PanelServices";

export type DetailState =
  | { status: "loading" }
  | { status: "ready"; order: OrderDetail }
  // 404 igual para "não existe" e "é de outra loja": a tela nunca diz qual dos dois.
  | { status: "notfound" }
  // Falha de rede/servidor. Se já havia um pedido na tela, ele fica (`order`) e a faixa avisa.
  | { status: "error"; order: OrderDetail | null };

// Carrega o detalhe de UM pedido. `refreshKey` muda quando o quadro mudou o pedido (tempo real, outra ação):
// o detalhe recarrega sozinho, mantendo o que já estava na tela enquanto busca.
export function useOrderDetail(orderId: string | null, refreshKey: string) {
  const router = useRouter();
  const { orders } = usePanelServices();
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Nova busca pedida pelo botão "Tentar de novo": o pedido continua na tela e o botão mostra "Tentando…".
  const [refreshing, setRefreshing] = useState(false);

  // Pedido novo (outro id): volta ao "carregando" em vez de mostrar o anterior por um instante.
  useEffect(() => {
    setState({ status: "loading" });
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    // Id vindo da URL (?pedido=) fora do formato da API: "não encontrado" SEM requisição (nunca vira caminho de pedido).
    if (!isOrderId(orderId)) {
      setRefreshing(false);
      setState({ status: "notfound" });
      return;
    }
    let active = true;
    orders.get(orderId).then((result) => {
      if (!active) return;
      setRefreshing(false);
      if (result.ok) return setState({ status: "ready", order: result.data.order });
      if (result.status === 401) return router.push("/login");
      if (result.status === 404) return setState({ status: "notfound" });
      setState((current) => ({ status: "error", order: current.status === "ready" ? current.order : current.status === "error" ? current.order : null }));
    });
    return () => {
      active = false;
    };
  }, [orderId, refreshKey, attempt, orders, router]);

  const retry = useCallback(() => {
    setRefreshing(true);
    setAttempt((count) => count + 1);
  }, []);
  return { state, retry, refreshing };
}
