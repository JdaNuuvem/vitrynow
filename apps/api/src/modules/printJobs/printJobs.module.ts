import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@meucardapio/db";
import { printAckSchema, setPrintModeSchema } from "@meucardapio/shared-types";
import { prismaAuditLogger } from "../../shared/audit";
import { useDomainErrors } from "../../shared/errors";
import { publishToStore } from "../../realtime/hub";
import { PrintJobService } from "./printJobs.service";
import { PrintModeService, loadPrintMode } from "./printMode.service";

export const printJobService = new PrintJobService(prisma, prismaAuditLogger, publishToStore);
export const printModeService = new PrintModeService(prisma, prismaAuditLogger);

// Rotas da fila de impressão. Dispositivo (token da impressora): claim e ack. Painel (sessão): reimprimir, teste e lista.
const printJobRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);

  // ───────────── Dispositivo ─────────────
  const device = { preHandler: app.requireDeviceAuth };

  // Configuração que o cliente lê a cada ciclo: o MODO da loja (a virada é atômica entre todas as impressoras).
  app.get("/api/device/config", device, async (request) => ({ mode: await loadPrintMode(prisma, request.deviceStoreId!) }));

  app.post("/api/device/print-jobs/claim", device, async (request) => {
    return printJobService.claim(request.deviceStoreId!, request.deviceTokenId!);
  });

  app.post("/api/device/print-jobs/:id/ack", device, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = printAckSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "corpo inválido", code: "VALIDATION_ERROR" });
    return printJobService.ack(request.deviceStoreId!, request.deviceTokenId!, id, parsed.data);
  });

  // ───────────── Painel ─────────────
  // Modo de impressão da loja: só o OWNER altera (auditado). A troca RECONCILIA no mesmo ato (ADR-0004 §8.13).
  app.get("/api/store/print-mode", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request) => printModeService.get(request.user.storeId));
  // Quem não é OWNER recebe 403 e a TENTATIVA fica registrada (print.mode_change_denied).
  const ownerOrRecordDenied = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role === "OWNER") return;
    await printModeService.recordDenied(request.user, (request.body as { mode?: unknown } | null)?.mode);
    reply.code(403).send({ error: "ação restrita ao dono da loja" });
  };
  // Limite de taxa POR LOJA (a troca de modo é rara e mexe na impressão da cozinha inteira): 10 por minuto, janela deslizante em memória.
  const modeHits = new Map<string, number[]>();
  const modeRateLimited = (storeId: string) => {
    const now = Date.now();
    const recent = (modeHits.get(storeId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 10) {
      modeHits.set(storeId, recent);
      return true;
    }
    recent.push(now);
    modeHits.set(storeId, recent);
    return false;
  };
  app.put("/api/store/print-mode", { preHandler: [app.requirePanelAuth, ownerOrRecordDenied] }, async (request, reply) => {
    if (modeRateLimited(request.user.storeId)) {
      reply.header("Retry-After", "60");
      return reply.code(429).send({ error: "Muitas tentativas. Aguarde um minuto e tente de novo.", code: "RATE_LIMITED" });
    }
    const parsed = setPrintModeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "modo inválido", code: "VALIDATION_ERROR" });
    return printModeService.set({ storeId: request.user.storeId, userId: request.user.userId }, parsed.data.mode);
  });

  const panel = { preHandler: app.requirePanelAuth };
  const actorOf = (request: { user: { storeId: string; userId: string; role: "OWNER" | "STAFF" } }) => ({ storeId: request.user.storeId, userId: request.user.userId, role: request.user.role });

  app.post("/api/orders/:id/reprint", panel, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(201).send({ job: await printJobService.reprint(actorOf(request), id) });
  });

  // Teste de impressora: só o dono (mexe na fila da loja inteira).
  app.post("/api/print-jobs/test", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    return reply.code(201).send({ job: await printJobService.createTest(actorOf(request)) });
  });

  app.get("/api/print-jobs", panel, async (request) => {
    const query = request.query as { orderId?: string; limit?: string };
    return { jobs: await printJobService.list(request.user.storeId, { orderId: query.orderId, limit: Number(query.limit) || undefined }) };
  });
};

export default printJobRoutes;
