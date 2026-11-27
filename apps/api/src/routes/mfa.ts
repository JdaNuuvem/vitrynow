import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { mfaChallengeSchema, mfaVerifySchema, type MfaPurpose } from "@meucardapio/shared-types";
import { sendMfaCodeEmail } from "../lib/email";
import { createChallenge, maskEmail, verifyChallenge } from "../lib/mfa";

const PURPOSE_LABELS: Record<MfaPurpose, string> = {
  refund: "estorno de pagamento",
  change_password: "troca de senha",
  delete_user: "remoção de usuário",
  anonymize_customer: "remoção de dados pessoais de um cliente",
  export_customer: "exportação dos dados de um cliente",
  connect_payment: "conexão da conta do Mercado Pago",
  disconnect_payment: "desconexão da conta do Mercado Pago",
  device_token_create: "criação de chave de impressora",
  device_token_revoke: "revogação de chave de impressora",
  cancel_subscription: "cancelamento da assinatura",
  invite_owner: "convite de um novo dono",
};

const mfaRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/mfa/challenge",
    { preHandler: app.requirePanelAuth, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = mfaChallengeSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const user = await prisma.user.findUnique({ where: { id: request.user.userId } });
      if (!user) return reply.code(401).send({ error: "não autenticado" });

      const { challenge, code } = await createChallenge(user.id, parsed.data.purpose);
      await sendMfaCodeEmail({ to: user.email, code, purposeLabel: PURPOSE_LABELS[parsed.data.purpose] });
      return reply.code(201).send({ challengeId: challenge.id, expiresAt: challenge.expiresAt, maskedEmail: maskEmail(user.email) });
    },
  );

  app.post(
    "/api/mfa/verify",
    { preHandler: app.requirePanelAuth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = mfaVerifySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const outcome = await verifyChallenge(request.user.userId, parsed.data.challengeId, parsed.data.code);
      if (outcome === "ok") return { ok: true };
      if (outcome === "locked") return reply.code(429).send({ error: "muitas tentativas — peça um novo código" });
      if (outcome === "expired") return reply.code(400).send({ error: "código expirado — peça um novo código" });
      return reply.code(400).send({ error: "Código incorreto. Confira e tente de novo." });
    },
  );
};

export default mfaRoutes;
