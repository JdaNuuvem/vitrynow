import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { deviceAlertBodySchema } from "@meucardapio/shared-types";
import { prismaAuditLogger } from "../../shared/audit";
import { publishToStore } from "../../realtime/hub";
import { limited, tooMany } from "../../lib/slidingLimit";
import { clientKey } from "../../lib/clientKey";
import { DeviceAlertService } from "./deviceAlerts.service";

export const deviceAlertService = new DeviceAlertService(prisma, publishToStore);

// PC-24: alertas dos dispositivos. O cliente manda (código fechado, sem texto livre); o dono lê. TELEMETRIA NÃO CONFIÁVEL.
const deviceAlertRoutes: FastifyPluginAsync = async (app) => {
  // Cliente (token da impressora). Limite 30/min POR TOKEN (chave = hash do Bearer, nunca o valor), corpo pequeno, schema estrito.
  // Token inválido ou revogado ⇒ 401 do `requireDeviceAuth` ANTES de qualquer gravação. Resposta SEMPRE 204 quando aceito.
  app.post(
    "/api/device/alerts",
    {
      bodyLimit: 2048,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request: { headers: { authorization?: string }; ip: string }) =>
            "device-alert:" + createHash("sha256").update(request.headers.authorization ?? clientKey(request.ip)).digest("hex").slice(0, 24),
        },
      },
      // Contador por IP ANTES da autenticação: uma requisição com `Authorization` aleatório (token inexistente) não cairia no limite por
      // token e custaria uma consulta indexada cada; por IP o volume de tentativas sem token válido tem teto (sem gravar nada).
      onRequest: async (request, reply) => {
        if (limited(`alerts-ip:${clientKey(request.ip)}`, 120)) return tooMany(reply); // IPv6 ⇒ /64 (SEC-23): girar o fim do endereço não escapa
      },
      preHandler: app.requireDeviceAuth,
    },
    async (request, reply) => {
      const parsed = deviceAlertBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "corpo inválido", code: "VALIDATION_ERROR" });
      await deviceAlertService.record({
        storeId: request.deviceStoreId!,
        tokenId: request.deviceTokenId!,
        code: parsed.data.code,
        orderId: parsed.data.orderId,
        clientVersion: parsed.data.clientVersion,
      });
      return reply.code(204).send();
    },
  );

  // Dono (sessão do painel). STAFF ⇒ 403 e a tentativa fica registrada, como na troca de modo.
  app.get("/api/device-alerts", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    if (request.user.role !== "OWNER") {
      // A negativa grava auditoria: balde por USUÁRIO (10/min), como na troca de modo; passando disso, 429 sem gravar mais nada.
      if (limited(`denied-alerts:${request.user.userId}`, 10)) return tooMany(reply);
      prismaAuditLogger.log({ storeId: request.user.storeId, userId: request.user.userId, action: "device_alert.read_denied", targetType: "Store", targetId: request.user.storeId });
      return reply.code(403).send({ error: "ação restrita ao dono da loja", code: "FORBIDDEN_ROLE" });
    }
    return deviceAlertService.list(request.user.storeId);
  });
};

export default deviceAlertRoutes;
