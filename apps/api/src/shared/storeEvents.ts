import { publishToStore } from "../realtime/hub";

// Porta de notificação em tempo real: o serviço diz "o pedido mudou", o adaptador decide
// como avisar painel e print-client (hoje, WebSocket em memória).
export interface StoreEvents {
  orderUpdated(storeId: string, orderId: string): void;
}

export const realtimeStoreEvents: StoreEvents = {
  orderUpdated: (storeId, orderId) => publishToStore(storeId, { type: "order.updated", orderId }),
};
