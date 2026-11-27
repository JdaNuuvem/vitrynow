import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "ws";
import { prisma } from "@meucardapio/db";
import { allowedOrigin } from "../lib/securityConfig";
import { subscribe, trackDeviceSocket, trackSessionSocket, trackUserSocket, WS_CLOSE_SESSION_REVOKED } from "../realtime/hub";

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
            return reply.code(403).send({ error: "Não foi possível confirmar a origem do acesso. Atualize a página.", code: "ORIGIN_MISMATCH" });
          }
        },
        app.requirePanelAuth,
      ],
    },
    (socket, request) => {
      const { userId, storeId, sid, role } = request.user;
      const ws = socket as unknown as WebSocket;
      subscribe(storeId, ws, role);
      trackUserSocket(userId, ws);
      if (sid) trackSessionSocket(sid, ws);

      const claims = readClaims(request.cookies?.mc_session, app);

      // ST-31: o socket não sobrevive ao token. Fecha no vencimento (o navegador reconecta com o cookie
      // já renovado pelas chamadas HTTP); a revalidação periódica abaixo cobre usuário, versão e logout.
      let expiryTimer: NodeJS.Timeout | undefined;
      if (claims.exp !== null) {
        const ms = Math.max(0, claims.exp * 1000 - Date.now());
        expiryTimer = setTimeout(() => ws.close(WS_CLOSE_SESSION_REVOKED, "sessão vencida"), Math.min(ms, 2_147_000_000));
        expiryTimer.unref();
      }

      const timer = setInterval(async () => {
        try {
          if (claims.exp !== null && Date.now() >= claims.exp * 1000) return void ws.close(WS_CLOSE_SESSION_REVOKED, "sessão vencida");
          const [user, revoked] = await Promise.all([
            prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } }),
            sid ? prisma.revokedSession.findUnique({ where: { sid }, select: { sid: true } }) : Promise.resolve(null),
          ]);
          if (!user || revoked || (claims.tv !== null && user.tokenVersion !== claims.tv)) {
            ws.close(WS_CLOSE_SESSION_REVOKED, "sessão encerrada");
          }
        } catch {
          // falha transitória do banco: tenta de novo no próximo ciclo
        }
      }, REVALIDATE_MS);
      timer.unref();
      ws.on("close", () => {
        clearInterval(timer);
        if (expiryTimer) clearTimeout(expiryTimer);
      });
    },
  );

  app.get(
    "/ws/device",
    { websocket: true, preHandler: app.requireDeviceAuth },
    (socket, request) => {
      const ws = socket as unknown as WebSocket;
      const deviceTokenId = request.deviceTokenId!;
      subscribe(request.deviceStoreId!, ws, "DEVICE");
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

function readClaims(token: string | undefined, app: import("fastify").FastifyInstance): { tv: number | null; exp: number | null } {
  if (!token) return { tv: null, exp: null };
  try {
    const payload = app.jwt.decode<{ tv?: number; exp?: number }>(token);
    return { tv: typeof payload?.tv === "number" ? payload.tv : null, exp: typeof payload?.exp === "number" ? payload.exp : null };
  } catch {
    return { tv: null, exp: null };
  }
}

export default realtimeRoutes;
