import type { FastifyPluginAsync } from "fastify";
import { createFeedbackSchema } from "@meucardapio/shared-types";
import { prisma } from "@meucardapio/db";
import { logAudit } from "../lib/audit";

const feedbackRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/feedback", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const parsed = createFeedbackSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { storeId, userId } = request.user;
    // O texto vai para a tabela PRÓPRIA; a auditoria guarda só QUE foi enviado e o tamanho (RN-PV-27, ADR-0014 §3.4).
    await prisma.feedback.create({ data: { storeId, userId, message: parsed.data.message } });
    logAudit({ storeId, userId, action: "feedback.sent", metadata: { length: parsed.data.message.length } });
    return reply.code(201).send({ ok: true });
  });
};

export default feedbackRoutes;
