import type { FastifyReply, FastifyRequest } from "fastify";
import type { MfaPurpose } from "@meucardapio/shared-types";
import { mfaEnforced, spendProof } from "./mfa";

// preHandler: encadear depois de requirePanelAuth. Com MFA_ENFORCED=true, a ação só passa
// com o header x-mfa-challenge apontando para um código verificado (uso único, 10 min).
export function requireMfa(purpose: MfaPurpose) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await mfaProofAccepted(request, purpose))) {
      reply.code(403).send({ error: "Confirmação de segurança necessária.", code: "MFA_REQUIRED", purpose });
    }
  };
}

// Versão para decisão dentro da rota (ex.: cancelamento só exige MFA quando precisa estornar).
// Com MFA_ENFORCED desligado sempre aceita; ligado, gasta a prova de uso único.
export async function mfaProofAccepted(request: FastifyRequest, purpose: MfaPurpose): Promise<boolean> {
  if (!mfaEnforced()) return true;
  const challengeId = request.headers["x-mfa-challenge"];
  return typeof challengeId === "string" && (await spendProof(request.user.userId, challengeId, purpose));
}
