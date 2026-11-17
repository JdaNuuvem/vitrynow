import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "@meucardapio/db";
import { anonymizeCustomerSchema, anonymizeTargetSchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import { requireMfa } from "../../lib/mfaGate";
import { PrivacyService, type PrivacyActor } from "./privacy.service";

export const privacyService = new PrivacyService(prisma);

const actorOf = (request: FastifyRequest): PrivacyActor => ({ storeId: request.user.storeId, userId: request.user.userId, role: request.user.role });

// Privacidade (LGPD, API-52). Só OWNER; STAFF recebe 403 FORBIDDEN_ROLE. Em Consulta vale (obrigação legal, RN-PV-10); a política de fase
// (routePolicy.ts, API-09) deve classificar estas rotas como liberadas na Consulta e bloqueadas na Suspensão.
const privacyRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);
  const ownerOnly = async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (request.user.role !== "OWNER") reply.code(403).send({ error: "Só o dono da loja pode fazer isso.", code: "FORBIDDEN_ROLE" });
  };
  const limit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

  // Prévia: quantos pedidos, período e o que bloqueia. Não devolve nome, telefone nem endereço.
  app.post("/api/privacy/anonymize/preview", { preHandler: [app.requirePanelAuth, ownerOnly], config: limit }, async (request, reply) => {
    const parsed = anonymizeTargetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Informe o telefone OU o código do pedido.", code: "VALIDATION_ERROR" });
    return privacyService.preview(actorOf(request), parsed.data);
  });

  // Execução: irreversível. OWNER, MFA (quando ativa), motivo por código e a confirmação repete o efeito (`expectedOrders`).
  app.post("/api/privacy/anonymize", { preHandler: [app.requirePanelAuth, ownerOnly, requireMfa("anonymize_customer")], config: limit }, async (request, reply) => {
    const parsed = anonymizeCustomerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Pedido inválido.", code: "VALIDATION_ERROR" });
    return privacyService.anonymize(actorOf(request), parsed.data);
  });
};

export default privacyRoutes;
