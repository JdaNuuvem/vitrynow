import type { WebSocket } from "ws";
import type { WsServerMessage } from "@meucardapio/shared-types";

// Pub/sub em memória: um canal por loja. Usado tanto pelo painel (kanban em tempo
// real, substitui o pollSales de 60s do original) quanto pelo print-client (substitui
// a dupla WS 43218/43219 + Cloud Functions por uma única conexão persistente).
// Para múltiplas instâncias da API, trocar por um pub/sub via Redis sem mudar a API pública.
const channels = new Map<string, Set<WebSocket>>();

export function subscribe(storeId: string, socket: WebSocket): void {
  let set = channels.get(storeId);
  if (!set) {
    set = new Set();
    channels.set(storeId, set);
  }
  set.add(socket);

  socket.on("close", () => {
    set?.delete(socket);
    if (set && set.size === 0) channels.delete(storeId);
  });
}

export function publishToStore(storeId: string, message: WsServerMessage): void {
  const set = channels.get(storeId);
  if (!set) return;
  const payload = JSON.stringify(message);
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}
