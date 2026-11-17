import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { requireMfa } from "../../lib/mfaGate";
import { allowedOrigin } from "../../lib/securityConfig";
import { CodedError, useDomainErrors } from "../../shared/errors";
import type { StorePaymentsService } from "./storePayments.service";

// Painel: conectar o Mercado Pago da loja (OAuth), ver o estado e desconectar. SÓ o dono. Resposta por allowlist:
// nunca token, nunca o id inteiro do vendedor.

/** Callback fixo no servidor (nunca vem do cliente): é o mesmo endereço cadastrado no aplicativo do Mercado Pago. */
export function redirectUriFor(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.PUBLIC_API_URL ?? allowedOrigin()).replace(/\/+$/, "");
  return `${base}/api/store/payments/mercadopago/callback`;
}

// Motivos do redirecionamento de volta ao painel (conjunto FECHADO: nada do provedor chega à URL).
const RETURN_REASONS = new Set(["OAUTH_STATE_INVALID", "OAUTH_CODE_INVALID", "PAYMENT_PROVIDER_UNAVAILABLE", "MP_ACCOUNT_IN_USE"]);

// A sessão (`sid`) amarra o `state` do OAuth ao navegador que o iniciou (D1-1). Todo token do painel tem `sid`.
function actorOf(request: FastifyRequest) {
  const { userId, storeId, sid } = request.user;
  if (!sid) throw new CodedError(401, "SESSION_REVOKED", "Sessão inválida. Entre de novo.");
  return { userId, storeId, sid };
}

export function buildStorePaymentRoutes(service: StorePaymentsService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    const ownerOnly = [app.requirePanelAuth, app.requireOwner];

    app.get("/api/store/payments", { preHandler: ownerOnly }, async (request) => {
      return service.view(request.user.storeId);
    });

    app.post(
      "/api/store/payments/mercadopago/connect",
      { preHandler: [...ownerOnly, requireMfa("connect_payment")], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request) => {
        return service.startConnect(actorOf(request), redirectUriFor());
      },
    );

    // O navegador do dono volta do Mercado Pago para cá: exige a sessão (cookie) e SEMPRE responde com redirecionamento
    // para o painel, com um motivo de lista fechada. `Referrer-Policy: no-referrer` e sem cache: o `code` está na URL.
    app.get(
      "/api/store/payments/mercadopago/callback",
      { preHandler: ownerOnly, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
      async (request, reply) => {
        reply.header("Referrer-Policy", "no-referrer").header("Cache-Control", "no-store");
        const { code, state } = request.query as { code?: unknown; state?: unknown };
        const back = (query: string) => reply.redirect(`${allowedOrigin().replace(/\/+$/, "")}/dashboard/pagamentos?${query}`, 302);
        if (typeof code !== "string" || typeof state !== "string" || !code || !state || code.length > 500 || state.length > 200) {
          return back("mp=erro&motivo=OAUTH_STATE_INVALID");
        }
        try {
          await service.completeConnect(actorOf(request), { code, state, redirectUri: redirectUriFor() });
          return back("mp=ok");
        } catch (error) {
          const reason = error instanceof CodedError && RETURN_REASONS.has(error.code ?? "") ? error.code : "PAYMENT_PROVIDER_UNAVAILABLE";
          if (!(error instanceof CodedError)) request.log.warn({ err: { message: (error as Error).message } }, "payment_account.callback_failed");
          return back(`mp=erro&motivo=${reason}`);
        }
      },
    );

    app.post(
      "/api/store/payments/mercadopago/disconnect",
      { preHandler: [...ownerOnly, requireMfa("disconnect_payment")] },
      async (request) => {
        await service.disconnect(actorOf(request));
        return { ok: true };
      },
    );
  };
}
