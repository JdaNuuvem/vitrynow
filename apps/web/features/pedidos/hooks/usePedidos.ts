"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { statusLabel } from "@/core/domain/orderLabels";
import type { Deliverer, Order } from "@/core/domain/orders";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";
import { buildCancelBody, type CancelDraft } from "../cancelReasons";
import { hiddenOpenCount } from "../hiddenOpen";
import { explainOrderError } from "../orderErrors";
import type { CardAction } from "../orderActions";
import { orderLabel } from "@/shared/format/orderCode";

export type LoadState = "loading" | "ready" | "error";

// Oferta de "Desfazer" depois de avançar um pedido (spec 02 §4). Um por vez.
export type UndoOffer = { orderId: string; text: string };

// Resultado de cancelar/recusar (contrato B3 §2.2): o pedido só muda quando o estorno é aceito.
export type CancelOutcome =
  | { kind: "done" }
  // Estorno ainda não aceito (HTTP 202): o pedido CONTINUA como está; a folha fica aberta com "Tentar de novo".
  | { kind: "refund-pending" }
  | { kind: "error"; message: string };

export function usePedidos() {
  const router = useRouter();
  const { runProtected } = useSecurityConfirm();
  const { orders: ordersGateway, deliverers: deliverersGateway, realtime } = usePanelServices();
  const [orders, setOrders] = useState<Order[]>([]);
  // Abertos que o teto da API deixou de fora (API-70): a faixa do quadro diz quantos. Falha de recarga mantém o último valor.
  const [openHidden, setOpenHidden] = useState(0);
  const [deliverers, setDeliverers] = useState<Deliverer[]>([]);
  // Erro de uma ação, mostrado na página (role=alert) em vez de alert() nativo.
  const [notice, setNotice] = useState<string | null>(null);
  const [undoOffer, setUndoOffer] = useState<UndoOffer | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Carregando é diferente de vazio: antes da 1ª resposta a tela NÃO pode dizer "Nenhum pedido aqui".
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const reload = useCallback(async () => {
    const result = await ordersGateway.list();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      // Falha depois de já ter mostrado pedidos: mantém a última lista; só a 1ª carga vira erro.
      else setLoadState((current) => (current === "ready" ? current : "error"));
      return;
    }
    setOrders(result.data.orders);
    setOpenHidden(hiddenOpenCount(result.data));
    setLoadState("ready");
  }, [ordersGateway, router]);

  useEffect(() => {
    reload();
    deliverersGateway.list().then((result) => {
      if (result.ok) setDeliverers(result.data.deliverers);
    });
    return realtime.subscribe(reload);
  }, [reload, deliverersGateway, realtime]);

  // Falha de uma ação: mostra o texto certo e, se o pedido mudou por outro lado, recarrega.
  const fail = useCallback(
    (result: Extract<HttpResult<unknown>, { ok: false }>): string => {
      if (result.status === 401) router.push("/login");
      const explained = explainOrderError(result);
      if (explained.reload) void reload();
      return explained.message;
    },
    [reload, router],
  );

  // Avança o pedido pela aresta que o SERVIDOR listou (allowedTransitions). A tela não decide o fluxo.
  const transition = useCallback(
    async (order: Order, action: CardAction) => {
      setNotice(null);
      setBusyId(order.id);
      const result = await ordersGateway.transition(order.id, action.to);
      setBusyId(null);
      if (!result.ok) return setNotice(fail(result));
      await reload();
      setUndoOffer(result.data.order.canUndo ? { orderId: order.id, text: `${orderLabel(order.code)} · ${statusLabel(action.to)}` } : null);
    },
    [ordersGateway, reload, fail],
  );

  const undo = useCallback(
    async (orderId: string) => {
      setNotice(null);
      setUndoOffer(null);
      const result = await ordersGateway.undo(orderId);
      if (!result.ok) return setNotice(fail(result));
      await reload();
    },
    [ordersGateway, reload, fail],
  );

  // Cancela/recusa com motivo. Com dinheiro online a API pode pedir o código de segurança (MFA): o
  // runProtected abre o passo extra e repete a chamada com o comprovante.
  const cancel = useCallback(
    async (order: Order, draft: CancelDraft, acknowledgeClosedCash = false): Promise<CancelOutcome> => {
      const body = buildCancelBody(draft, acknowledgeClosedCash);
      const result = await runProtected("refund", (options) => ordersGateway.cancel(order.id, body, options));
      if (!result.ok) return { kind: "error", message: fail(result) };
      if (result.data.refund === "PENDING") {
        void reload();
        return { kind: "refund-pending" };
      }
      setUndoOffer(null);
      await reload();
      return { kind: "done" };
    },
    [ordersGateway, reload, fail, runProtected],
  );

  const retryRefund = useCallback(
    async (order: Order): Promise<CancelOutcome> => {
      const result = await runProtected("refund", (options) => ordersGateway.retryRefund(order.id, options));
      if (!result.ok) return { kind: "error", message: fail(result) };
      await reload();
      return result.data.refund === "PENDING" ? { kind: "refund-pending" } : { kind: "done" };
    },
    [ordersGateway, reload, fail, runProtected],
  );

  const assignDeliverer = useCallback(
    async (order: Order, delivererId: string) => {
      await ordersGateway.assignDeliverer(order.id, delivererId || null);
      reload();
    },
    [ordersGateway, reload],
  );

  return {
    orders,
    openHidden,
    loadState,
    retryLoad: () => {
      setLoadState("loading");
      void reload();
    },
    deliverers,
    notice,
    undoOffer,
    busyId,
    transition,
    undo,
    cancel,
    retryRefund,
    assignDeliverer,
    dismissNotice: () => setNotice(null),
    dismissUndo: () => setUndoOffer(null),
  };
}
