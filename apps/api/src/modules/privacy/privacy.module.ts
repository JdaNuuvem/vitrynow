import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@meucardapio/db";
import { anonymizeTargetSchema, anonymizeCustomerSchema, exportCustomerSchema } from "@meucardapio/shared-types";
import { ServerBusyError, sendServerBusy, useDomainErrors } from "../../shared/errors";
import { DUMMY_HASH, bcryptPasswordHasher as passwordHasher } from "../../shared/passwordHasher";
import { clientKey } from "../../lib/clientKey";
import { AccountAttemptCap } from "../../lib/accountAttemptCap";
import { LoginThrottle } from "../../lib/loginThrottle";
import { mfaEnforced } from "../../lib/mfa";
import { mfaProofAccepted } from "../../lib/mfaGate";
import { PrivacyService, type PrivacyActor } from "./privacy.service";

export const privacyService = new PrivacyService(prisma);

const actorOf = (request: FastifyRequest): PrivacyActor => ({ storeId: request.user.storeId, userId: request.user.userId, role: request.user.role });

/**
 * Reautenticação para a ação IRREVERSÍVEL (parecer da Nightingale R1, decisão do Leonardo): com MFA ativa vale o código (uso único);
 * SEM MFA ativa o dono digita a senha atual (`currentPassword` no corpo), porque um cookie de sessão roubado não pode apagar clientes.
 * Não bloqueamos o direito do titular por o dono não ter MFA. A senha errada conta numa trava no mesmo molde da do login (por conta e
 * IP, bloqueio progressivo, em memória por instância; mover ao banco antes de 2+ instâncias) e NUNCA é registrada.
 */
/**
 * Chave geral das ações de privacidade que mexem em dado real (ADR-0014): DESLIGADA por padrão. Só liga em DEV/teste até o parecer
 * jurídico (LGPD P1-P17). Lida a cada requisição. Desligada: 404 FEATURE_DISABLED (a rota "não existe").
 */
export const privacyActionsEnabled = () => process.env.PRIVACY_ACTIONS_ENABLED === "true";
const featureOff = (reply: FastifyReply) => reply.code(404).send({ error: "Recurso indisponível.", code: "FEATURE_DISABLED" });

const reauthThrottle = new LoginThrottle();
// E um teto por CONTA, de qualquer IP: a ameaça é sessão roubada, e quem a tem troca de IP (10 tentativas por 15 min).
const reauthAccountCap = new AccountAttemptCap(10, 15 * 60 * 1000);

async function reauthorize(request: FastifyRequest, reply: FastifyReply, currentPassword: string | undefined, purpose: "anonymize_customer" | "export_customer" = "anonymize_customer"): Promise<boolean> {
  if (mfaEnforced()) {
    if (await mfaProofAccepted(request, purpose)) return true;
    reply.code(403).send({ error: "Confirmação de segurança necessária.", code: "MFA_REQUIRED", purpose });
    return false;
  }
  // Senha AUSENTE não gasta tentativa (RN-PV-28): só a senha ERRADA conta. A tela nem envia sem o campo preenchido.
  if (!currentPassword) {
    reply.code(403).send({ error: "Digite sua senha para confirmar.", code: "REAUTH_REQUIRED" });
    return false;
  }
  const user = await prisma.user.findUnique({ where: { id: request.user.userId }, select: { email: true, passwordHash: true } });
  const key = user?.email ?? request.user.userId;
  // Duas reservas SÍNCRONAS, antes do bcrypt: por (conta, IP) e por CONTA (qualquer IP). Negada ⇒ 429 SEM testar a senha, mesmo certa.
  const accountKey = `reauth:${request.user.userId}`;
  const cap = reauthAccountCap.reserve(accountKey);
  if (!cap.allowed) {
    reply.header("Retry-After", String(cap.retryAfterSeconds)).code(429).send({ error: "Muitas tentativas. Aguarde um pouco e tente de novo.", code: "RATE_LIMITED" });
    return false;
  }
  const slot = reauthThrottle.reserve(key, request.ip);
  if (!slot.allowed) {
    reauthAccountCap.succeed(accountKey); // a tentativa negada pelo par não consome o teto da conta
    reply.header("Retry-After", String(slot.retryAfterSeconds)).code(429).send({ error: "Muitas tentativas. Aguarde um pouco e tente de novo.", code: "RATE_LIMITED" });
    return false;
  }
  // Pela MESMA faixa do login (SEC-34): `DUMMY_HASH` se a conta não existe. Faixa cheia (503) ⇒ nenhuma senha foi testada: devolve as DUAS reservas.
  let ok: boolean;
  try {
    ok = await passwordHasher.verify(currentPassword, user?.passwordHash ?? DUMMY_HASH, clientKey(request.ip));
  } catch (error) {
    if (error instanceof ServerBusyError) {
      reauthThrottle.refund(key, request.ip);
      reauthAccountCap.succeed(accountKey);
      sendServerBusy(reply);
      return false;
    }
    throw error;
  }
  if (!ok || !user) {
    reply.code(403).send({ error: "Senha incorreta.", code: "PASSWORD_INVALID" });
    return false;
  }
  reauthThrottle.succeed(key, request.ip);
  reauthAccountCap.succeed(accountKey);
  return true;
}

// Privacidade (LGPD, API-52). Só OWNER; STAFF recebe 403 FORBIDDEN_ROLE. Em Consulta vale (obrigação legal, RN-PV-10); a política de fase
// (routePolicy.ts, API-09) deve classificar estas rotas como liberadas na Consulta e bloqueadas na Suspensão.
const privacyRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);
  app.addHook("preHandler", async (_request, reply) => {
    if (!privacyActionsEnabled()) return featureOff(reply);
  });
  const limit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

  // Prévia: quantos pedidos, período e o que bloqueia. Não devolve nome, telefone nem endereço.
  app.post("/api/privacy/anonymize/preview", { preHandler: [app.requirePanelAuth, app.requireOwner], config: limit }, async (request, reply) => {
    const parsed = anonymizeTargetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Informe o telefone OU o código do pedido.", code: "VALIDATION_ERROR" });
    // `reauth`: qual confirmação a execução vai pedir (a tela mostra só a certa): código MFA quando a MFA está ativa, senão a senha atual.
    return { ...(await privacyService.preview(actorOf(request), parsed.data)), reauth: mfaEnforced() ? ("MFA" as const) : ("PASSWORD" as const) };
  });

  // Exportação dos dados de um titular (JSON). OWNER + reautenticação (MFA ou senha) + auditoria sem o conteúdo. Não é descartável: sem cache.
  app.post("/api/privacy/export", { preHandler: [app.requirePanelAuth, app.requireOwner], config: limit }, async (request, reply) => {
    const parsed = exportCustomerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Informe o telefone OU o código do pedido.", code: "VALIDATION_ERROR" });
    const { currentPassword, ...target } = parsed.data;
    if (!(await reauthorize(request, reply, currentPassword, "export_customer"))) return reply;
    reply.header("Cache-Control", "no-store");
    return privacyService.exportData(actorOf(request), target);
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
