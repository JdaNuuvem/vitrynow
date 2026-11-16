import type { FastifyPluginAsync } from "fastify";
import type { AuditLogReader } from "./audit.repository";

const RECENT_LIMIT = 200;

// Consulta do log de ações sensíveis — restrito a OWNER. É só leitura, sem regra de
// negócio, então a rota fala direto com o leitor (sem camada de serviço no meio).
export function buildAuditRoutes(reader: AuditLogReader): FastifyPluginAsync {
  return async (app) => {
    app.get("/api/audit-log", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request) => {
      return { logs: await reader.listRecent(request.user.storeId, RECENT_LIMIT) };
    });
  };
}
