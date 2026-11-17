import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { prisma } from "@meucardapio/db";
import { anonymizeCustomerSchema, anonymizeTargetSchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import { LoginThrottle } from "../../lib/loginThrottle";
import { mfaEnforced } from "../../lib/mfa";
import { mfaProofAccepted } from "../../lib/mfaGate";
import { PrivacyService, type PrivacyActor } from "./privacy.service";

export const privacyService = new PrivacyService(prisma);

// Hash de mentira para a comparação gastar o mesmo tempo quando o usuário não existe.
const DUMMY_HASH = bcrypt.hashSync(`nao-existe-${Math.random()}-${Date.now()}`, 10);

const actorOf = (request: FastifyRequest): PrivacyActor => ({ storeId: request.user.storeId, userId: request.user.userId, role: request.user.role });

/**
 * Reautenticação para a ação IRREVERSÍVEL (parecer da Nightingale R1, decisão do Leonardo): com MFA ativa vale o código (uso único);
 * SEM MFA ativa o dono digita a senha atual (`currentPassword` no corpo), porque um cookie de sessão roubado não pode apagar clientes.
 * Não bloqueamos o direito do titular por o dono não ter MFA. A senha errada conta numa trava no mesmo molde da do login (por conta e
 * IP, bloqueio progressivo, em memória por instância; mover ao banco antes de 2+ instâncias) e NUNCA é registrada.
 */
const reauthThrottle = new LoginThrottle();

async function reauthorize(request: FastifyRequest, reply: FastifyReply, currentPassword: string | undefined): Promise<boolean> {
  if (mfaEnforced()) {
    if (await mfaProofAccepted(request, "anonymize_customer")) return true;
    reply.code(403).send({ error: "Confirmação de segurança necessária.", code: "MFA_REQUIRED", purpose: "anonymize_customer" });
    return false;
  }
  const user = await prisma.user.findUnique({ where: { id: request.user.userId }, select: { email: true, passwordHash: true } });
  const key = user?.email ?? request.user.userId;
  const slot = reauthThrottle.reserve(key, request.ip); // síncrono: a tentativa é contada ANTES do bcrypt
  if (!slot.allowed) {
    reply.header("Retry-After", String(slot.retryAfterSeconds)).code(429).send({ error: "Muitas tentativas. Aguarde um pouco e tente de novo.", code: "RATE_LIMITED" });
    return false;
  }
  const ok = await bcrypt.compare(currentPassword ?? "", user?.passwordHash ?? DUMMY_HASH);
  if (!ok || !currentPassword || !user) {
    reply.code(403).send({ error: currentPassword ? "Senha incorreta." : "Digite sua senha para confirmar.", code: currentPassword ? "PASSWORD_INVALID" : "REAUTH_REQUIRED" });
    return false;
  }
  reauthThrottle.succeed(key, request.ip);
  return true;
}

// Privacidade (LGPD, API-52). Só OWNER; STAFF recebe 403 FORBIDDEN_ROLE. Em Consulta vale (obrigação legal, RN-PV-10); a política de fase
// (routePolicy.ts, API-09) deve classificar estas rotas como liberadas na Consulta e bloqueadas na Suspensão.
const privacyRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);
  const limit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

  // Prévia: quantos pedidos, período e o que bloqueia. Não devolve nome, telefone nem endereço.
  app.post("/api/privacy/anonymize/preview", { preHandler: [app.requirePanelAuth, app.requireOwner], config: limit }, async (request, reply) => {
    const parsed = anonymizeTargetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Informe o telefone OU o código do pedido.", code: "VALIDATION_ERROR" });
    return privacyService.preview(actorOf(request), parsed.data);
  });

  // Execução: irreversível. OWNER, reautenticação (MFA ou senha), motivo por código e a confirmação repete o efeito (`expectedOrders`).
  app.post("/api/privacy/anonymize", { preHandler: [app.requirePanelAuth, app.requireOwner], config: limit }, async (request, reply) => {
    const parsed = anonymizeCustomerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Pedido inválido.", code: "VALIDATION_ERROR" });
    const { currentPassword, ...input } = parsed.data;
    if (!(await reauthorize(request, reply, currentPassword))) return reply;
    return privacyService.anonymize(actorOf(request), input);
  });
};

export default privacyRoutes;
