import type { WebSocket } from "ws";
import type { WsServerMessage } from "@meucardapio/shared-types";

// Pub/sub em memória: um canal por loja. Usado tanto pelo painel (kanban em tempo
// real, substitui o pollSales de 60s do original) quanto pelo print-client (substitui
// a dupla WS 43218/43219 + Cloud Functions por uma única conexão persistente).
// Para múltiplas instâncias da API, trocar por um pub/sub via Redis sem mudar a API pública.
const channels = new Map<string, Set<WebSocket>>();

// Sockets do painel por usuário: permite fechá-los na hora quando a sessão é revogada
// (troca/reset de senha, "sair de todos", remoção) — ADR-0008 §1.4.
const userSockets = new Map<string, Set<WebSocket>>();

export const WS_CLOSE_SESSION_REVOKED = 4401;

export function trackUserSocket(userId: string, socket: WebSocket): void {
  let set = userSockets.get(userId);
  if (!set) {
    set = new Set();
    userSockets.set(userId, set);
  }
  set.add(socket);
  socket.on("close", () => {
    set?.delete(socket);
    if (set && set.size === 0) userSockets.delete(userId);
  });
}

export function disconnectUser(userId: string): void {
  const set = userSockets.get(userId);
  if (!set) return;
  for (const socket of [...set]) socket.close(WS_CLOSE_SESSION_REVOKED, "sessão encerrada");
}

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
