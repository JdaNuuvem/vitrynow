import type { FastifyPluginAsync } from "fastify";
import { subscribe } from "../realtime/hub";

// Canal único por loja em tempo real — usado pelo painel (kanban) e pelo print-client.
// Substitui a dupla WS 43218/43219 (auth + push) do original por uma conexão por consumidor,
// autenticada no handshake (cookie de sessão para o painel, token de dispositivo para o print-client).
const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/ws/panel",
    { websocket: true, preHandler: app.requirePanelAuth },
    (socket, request) => {
      subscribe(request.user.storeId, socket as unknown as import("ws").WebSocket);
    },
  );

  app.get(
    "/ws/device",
    { websocket: true, preHandler: app.requireDeviceAuth },
    (socket, request) => {
      subscribe(request.deviceStoreId!, socket as unknown as import("ws").WebSocket);
    },
  );
};

export default realtimeRoutes;
