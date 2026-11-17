import type { Order } from "@/core/domain/orders";

// O que o detalhe precisa saber que mudou no pedido: ao mudar, ele recarrega sozinho (tempo real, outra aba, outra ação).
// Vale para o quadro e para o histórico (os dois abrem o MESMO detalhe).
export const detailRefreshKey = (order: Order | undefined) =>
  order ? [order.status, order.payment?.status, order.payment?.refundPending, order.delivererId, order.canUndo].join("|") : "";
