import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { panelRoleSchema, type PanelRole } from "@meucardapio/shared-types";
import { prisma } from "@meucardapio/db";
import { printAckSchema, setPrintModeSchema } from "@meucardapio/shared-types";
import { prismaAuditLogger } from "../../shared/audit";
import { useDomainErrors } from "../../shared/errors";
import { limited, tooMany } from "../../lib/slidingLimit";
import { publishToPanel, publishToStore } from "../../realtime/hub";
import { PrintJobService } from "./printJobs.service";
import { PrintModeService, loadPrintMode } from "./printMode.service";

export const printJobService = new PrintJobService(prisma, prismaAuditLogger, publishToStore, () => new Date(), publishToPanel);
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
  // Limite de taxa (lib/slidingLimit): cada tentativa NEGADA grava auditoria, então ela também conta (balde por USUÁRIO: o STAFF nunca
  // gasta a cota do dono, que é por LOJA).
  // Quem não é OWNER recebe 403 e a TENTATIVA fica registrada (print.mode_change_denied); passando de 10 por minuto por usuário,
  // 429 sem gravar mais nada. A rota NUNCA se abre ao STAFF: a resposta é 403 ou 429, nunca o efeito.
  const ownerOrRecordDenied = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role === panelRoleSchema.enum.OWNER) return;
    if (limited(`denied:${request.user.userId}`, 10)) return tooMany(reply);
    await printModeService.recordDenied(request.user, (request.body as { mode?: unknown } | null)?.mode);
    return reply.code(403).send({ error: "ação restrita ao dono da loja" });
  };
  app.put("/api/store/print-mode", { preHandler: [app.requirePanelAuth, ownerOrRecordDenied] }, async (request, reply) => {
    if (limited(`mode:${request.user.storeId}`, 10)) return tooMany(reply); // balde da LOJA (10 trocas por minuto)
    const parsed = setPrintModeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "modo inválido", code: "VALIDATION_ERROR" });
    return printModeService.set({ storeId: request.user.storeId, userId: request.user.userId }, parsed.data.mode);
  });

  const panel = { preHandler: app.requirePanelAuth };
  const actorOf = (request: { user: { storeId: string; userId: string; role: PanelRole } }) => ({ storeId: request.user.storeId, userId: request.user.userId, role: request.user.role });

  app.post("/api/orders/:id/reprint", panel, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(201).send({ job: await printJobService.reprint(actorOf(request), id) });
  });

  // Teste de impressora: só o dono (mexe na fila da loja inteira).
  app.post("/api/print-jobs/test", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    return reply.code(201).send({ job: await printJobService.createTest(actorOf(request)) });
  });

  // N6: "Imprimir agora" num trabalho que passou da janela de 12 h. OWNER e STAFF; limite por USUÁRIO; STAFF segue a regra de contato da 2ª via.
  app.post("/api/print-jobs/:id/print-now", panel, async (request, reply) => {
    if (limited(`printnow:${request.user.userId}`, 30)) return tooMany(reply);
    const { id } = request.params as { id: string };
    return { job: await printJobService.printNow(actorOf(request), id) };
  });

  app.get("/api/print-jobs/summary", panel, async (request) => printJobService.summary(request.user.storeId));

  app.get("/api/print-jobs", panel, async (request) => {
    const query = request.query as { orderId?: string; limit?: string };
    return { jobs: await printJobService.list(request.user.storeId, { orderId: query.orderId, limit: Number(query.limit) || undefined }) };
  });
};

export default printJobRoutes;
