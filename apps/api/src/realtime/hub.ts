import type { WebSocket } from "ws";
import { DEVICE_ALERT_MONEY_CODES, WS_AUDIENCE, type WsServerMessage } from "@meucardapio/shared-types";

// Pub/sub em memória: um canal por loja. Usado tanto pelo painel (kanban em tempo
// real, substitui o pollSales de 60s do original) quanto pelo print-client (substitui
// a dupla WS 43218/43219 + Cloud Functions por uma única conexão persistente).
// Para múltiplas instâncias da API, trocar por um pub/sub via Redis sem mudar a API pública.
const channels = new Map<string, Set<WebSocket>>();

// Sockets do painel por usuário: permite fechá-los na hora quando a sessão é revogada
// (troca/reset de senha, "sair de todos", remoção) — ADR-0008 §1.4.
const userSockets = new Map<string, Set<WebSocket>>();

// Sockets do print-client por chave de impressora: revogar a chave fecha a conexão na hora.
const deviceSockets = new Map<string, Set<WebSocket>>();

export const WS_CLOSE_SESSION_REVOKED = 4401;

export function trackDeviceSocket(deviceTokenId: string, socket: WebSocket): void {
  let set = deviceSockets.get(deviceTokenId);
  if (!set) {
    set = new Set();
    deviceSockets.set(deviceTokenId, set);
  }
  set.add(socket);
  socket.on("close", () => {
    set?.delete(socket);
    if (set && set.size === 0) deviceSockets.delete(deviceTokenId);
  });
}

export function disconnectDevice(deviceTokenId: string): void {
  const set = deviceSockets.get(deviceTokenId);
  if (!set) return;
  for (const socket of [...set]) socket.close(WS_CLOSE_SESSION_REVOKED, "chave revogada");
}

// Sockets por sessão (sid): logout de UM aparelho fecha só os sockets daquela sessão (SEC-19 / ST-30).
const sessionSockets = new Map<string, Set<WebSocket>>();

export function trackSessionSocket(sid: string, socket: WebSocket): void {
  let set = sessionSockets.get(sid);
  if (!set) {
    set = new Set();
    sessionSockets.set(sid, set);
  }
  set.add(socket);
  socket.on("close", () => {
    set?.delete(socket);
    if (set && set.size === 0) sessionSockets.delete(sid);
  });
}

export function disconnectSession(sid: string): void {
  const set = sessionSockets.get(sid);
  if (!set) return;
  for (const socket of [...set]) socket.close(WS_CLOSE_SESSION_REVOKED, "sessão encerrada");
}

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

// Quem está do outro lado do socket: o painel entra com o papel da SESSÃO JÁ VERIFICADA (OWNER/STAFF, vindo do banco, nunca do cliente) e o
// print-client entra como DEVICE. O papel é OBRIGATÓRIO ao se inscrever e o padrão é FECHADO: só `OWNER` recebe mensagem de dono; papel
// ausente ou desconhecido, STAFF e DEVICE nunca recebem. Não existe rota que troque o papel de um usuário; se alguém criar uma, ela TEM de
// chamar `disconnectUser` (o socket aberto guarda o papel de quando conectou).
export type SocketRole = "OWNER" | "STAFF" | "DEVICE";
const socketRoles = new WeakMap<WebSocket, SocketRole>();

// Mensagens que só o OWNER pode receber (RN-CX-22): sinalizam dado que o STAFF não vê. A restrição vive AQUI, por tipo, e não em quem publica:
// nenhum chamador consegue esquecê-la. Regra do canal da loja: evento novo não leva valor monetário, dado pessoal nem segredo; o detalhe vem
// por rota autenticada com o papel certo.
const OWNER_ONLY_TYPES: ReadonlySet<WsServerMessage["type"]> = new Set(["cashier.difference_over_tolerance"]);

// `device.alert` com código de DINHEIRO também é de dono: o código denuncia a regra de não cobrar (PC-24); os demais (fila sem impressora, modo
// não confirmado) seguem a todos. O filtro é pelo conteúdo do tipo, aqui, para valer a qualquer publicador (rota, job).
const isOwnerOnly = (message: WsServerMessage): boolean =>
  OWNER_ONLY_TYPES.has(message.type) || (message.type === "device.alert" && DEVICE_ALERT_MONEY_CODES.includes(message.code));

export function subscribe(storeId: string, socket: WebSocket, role: SocketRole): void {
  socketRoles.set(socket, role);
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

function deliver(storeId: string, message: WsServerMessage, ownersOnly: boolean): void {
  const set = channels.get(storeId);
  if (!set) return;
  const payload = JSON.stringify(message);
  for (const socket of set) {
    const role = socketRoles.get(socket);
    if (ownersOnly && role !== "OWNER") continue;
    // API-47: a audiência é do TIPO da mensagem, não de quem publica. A impressora só recebe o que o tipo declara para `device`.
    if (role === "DEVICE" ? WS_AUDIENCE[message.type] === "panel" : role !== "OWNER" && role !== "STAFF") continue; // papel ausente/desconhecido: nada (fail-closed)
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

/** Todos da loja: painel (OWNER e STAFF) e print-client. Os tipos de dono (`OWNER_ONLY_TYPES`) são entregues SÓ ao OWNER mesmo por aqui. */
export function publishToStore(storeId: string, message: WsServerMessage): void {
  deliver(storeId, message, isOwnerOnly(message));
}

/** Só o PAINEL da loja (OWNER e STAFF); a impressora (DEVICE) nunca recebe. Para eventos de impressão do painel (N8). */
export function publishToPanel(storeId: string, message: WsServerMessage): void {
  const set = channels.get(storeId);
  if (!set) return;
  const ownersOnly = isOwnerOnly(message);
  const payload = JSON.stringify(message);
  for (const socket of set) {
    const role = socketRoles.get(socket);
    if (role !== "OWNER" && !(role === "STAFF" && !ownersOnly)) continue;
    if (WS_AUDIENCE[message.type] === "device") continue;
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

/** Só as conexões de OWNER da loja (STAFF e impressoras não recebem). */
export function publishToOwners(storeId: string, message: WsServerMessage): void {
  deliver(storeId, message, true);
}
