import type { FastifyPluginAsync } from "fastify";
import { createFeedbackSchema } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";

const feedbackRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/feedback", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const parsed = createFeedbackSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { storeId, userId } = request.user;
    logAudit({ storeId, userId, action: "feedback.sent", metadata: { message: parsed.data.message } });
    return reply.code(201).send({ ok: true });
  });
};

export default feedbackRoutes;
