import type { FastifyPluginAsync } from "fastify";
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
  app.put("/api/store/print-mode", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
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
