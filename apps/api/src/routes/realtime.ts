import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "ws";
import { prisma } from "@meucardapio/db";
import { allowedOrigin } from "../lib/securityConfig";
import { subscribe, trackDeviceSocket, trackUserSocket, WS_CLOSE_SESSION_REVOKED } from "../realtime/hub";

// Revalida a sessão do painel enquanto o socket está aberto: cobre falha de entrega do
// fechamento imediato (disconnectUser) e outras instâncias da API.
const REVALIDATE_MS = 2 * 60 * 1000;

// Canal único por loja em tempo real — usado pelo painel (kanban) e pelo print-client.
// Substitui a dupla WS 43218/43219 (auth + push) do original por uma conexão por consumidor,
// autenticada no handshake (cookie de sessão para o painel, token de dispositivo para o print-client).
const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/ws/panel",
    {
      websocket: true,
      preHandler: [
        // Browser sempre manda Origin no handshake de WebSocket: recusa origem diferente do painel
        // (WebSocket não passa pelo CORS). Clientes sem Origin (não-browser) seguem pelo cookie.
        async (request, reply) => {
          const origin = request.headers.origin;
          if (origin && origin !== allowedOrigin()) {
            return reply.code(403).send({ error: "origem não permitida", code: "ORIGIN_MISMATCH" });
          }
        },
        app.requirePanelAuth,
      ],
    },
    (socket, request) => {
      const { userId, storeId } = request.user;
      const ws = socket as unknown as WebSocket;
      subscribe(storeId, ws);
      trackUserSocket(userId, ws);

      const sessionTv = readTokenVersion(request.cookies?.mc_session, app);
      const timer = setInterval(async () => {
        try {
          const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
          if (!user || (sessionTv !== null && user.tokenVersion !== sessionTv)) {
            ws.close(WS_CLOSE_SESSION_REVOKED, "sessão encerrada");
          }
        } catch {
          // falha transitória do banco: tenta de novo no próximo ciclo
        }
      }, REVALIDATE_MS);
      timer.unref();
      ws.on("close", () => clearInterval(timer));
    },
  );

  app.get(
    "/ws/device",
    { websocket: true, preHandler: app.requireDeviceAuth },
    (socket, request) => {
      const ws = socket as unknown as WebSocket;
      const deviceTokenId = request.deviceTokenId!;
      subscribe(request.deviceStoreId!, ws);
      trackDeviceSocket(deviceTokenId, ws);

      // Revalida a chave enquanto o socket está aberto (cobre outra instância da API ou falha de entrega).
      const timer = setInterval(async () => {
        try {
          const token = await prisma.deviceToken.findUnique({ where: { id: deviceTokenId }, select: { revokedAt: true } });
          if (!token || token.revokedAt) ws.close(WS_CLOSE_SESSION_REVOKED, "chave revogada");
        } catch {
          // falha transitória do banco: tenta de novo no próximo ciclo
        }
      }, REVALIDATE_MS);
      timer.unref();
      ws.on("close", () => clearInterval(timer));
    },
  );
};

function readTokenVersion(token: string | undefined, app: import("fastify").FastifyInstance): number | null {
  if (!token) return null;
  try {
    const payload = app.jwt.decode<{ tv?: number }>(token);
    return typeof payload?.tv === "number" ? payload.tv : null;
  } catch {
    return null;
  }
}

export default realtimeRoutes;
