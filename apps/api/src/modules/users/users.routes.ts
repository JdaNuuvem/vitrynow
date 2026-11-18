import { clientIpOf } from "../../lib/clientIp";
import type { FastifyPluginAsync } from "fastify";
import { changePasswordSchema, createStaffUserSchema } from "@meucardapio/shared-types";
import { clientKey } from "../../lib/clientKey";
import { mfaProofAccepted, requireMfa } from "../../lib/mfaGate";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "../../lib/session";
import { disconnectUser } from "../../realtime/hub";
import { prisma } from "@meucardapio/db";
import { requireFeature, requireLimit } from "../../lib/subscription";
import { useDomainErrors } from "../../shared/errors";
import type { UsersService } from "./users.service";

// Gestão de equipe da loja (convidar/remover STAFF) + troca de senha — autenticado pelo painel.
// Os portões de plano (multi_user) e de MFA ficam aqui, na borda, como preHandlers.
export function buildUserRoutes(service: UsersService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);

    app.get("/api/users", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request) => {
      return { users: await service.list(request.user.storeId) };
    });

    app.post(
      "/api/users",
      {
        preHandler: [
          app.requirePanelAuth,
          app.requireOwner,
          requireFeature("multi_user"),
          // Limite de usuários do plano (SEC-21): conta quem já tem acesso à loja (o dono entra na conta).
          requireLimit("maxUsers", (request) => prisma.user.count({ where: { storeId: request.user.storeId } })),
        ],
      },
      async (request, reply) => {
        const parsed = createStaffUserSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
        // SEC-13: criar outro DONO é a ação de controle de acesso mais forte (o novo dono apaga e estorna): exige o código de uso único. STAFF não.
        if (parsed.data.role === "OWNER" && !(await mfaProofAccepted(request, "invite_owner"))) {
          return reply.code(403).send({ error: "Confirmação de segurança necessária.", code: "MFA_REQUIRED", purpose: "invite_owner" });
        }
        const user = await service.invite(request.user.storeId, parsed.data, clientKey(clientIpOf(request)));
        return reply.code(201).send({ user });
      },
    );

    app.post(
      "/api/users/:id/delete",
      { preHandler: [app.requirePanelAuth, app.requireOwner, requireMfa("delete_user")] },
      async (request) => {
        const { id } = request.params as { id: string };
        await service.remove(request.user, id);
        disconnectUser(id); // a linha sumiu: o JWT já morre, aqui fecha também o WebSocket aberto
        return { ok: true };
      },
    );

    app.post(
      "/auth/change-password",
      { preHandler: [app.requirePanelAuth, requireMfa("change_password")] },
      async (request, reply) => {
        const parsed = changePasswordSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
        const { tokenVersion } = await service.changePassword(request.user.userId, parsed.data, clientKey(clientIpOf(request)));
        // Derruba as OUTRAS sessões e sockets; este dispositivo recebe cookie na versão nova.
        disconnectUser(request.user.userId);
        reply.setCookie(SESSION_COOKIE, signSession(app, { id: request.user.userId, tokenVersion }), sessionCookieOptions());
        return { ok: true };
      },
    );
  };
}
