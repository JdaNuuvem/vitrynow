import type { FastifyReply, FastifyRequest } from "fastify";
import type { MfaPurpose } from "@meucardapio/shared-types";
import { mfaEnforced, spendProof } from "./mfa";

// preHandler: encadear depois de requirePanelAuth. Com MFA_ENFORCED=true, a ação só passa
// com o header x-mfa-challenge apontando para um código verificado (uso único, 10 min).
export function requireMfa(purpose: MfaPurpose) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!mfaEnforced()) return;
    const challengeId = request.headers["x-mfa-challenge"];
    const accepted = typeof challengeId === "string" && (await spendProof(request.user.userId, challengeId, purpose));
    if (!accepted) {
      reply.code(403).send({ error: "Confirmação de segurança necessária.", code: "MFA_REQUIRED", purpose });
    }
  };
}
