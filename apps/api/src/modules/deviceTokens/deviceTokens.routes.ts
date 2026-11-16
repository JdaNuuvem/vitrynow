import type { FastifyPluginAsync } from "fastify";
import { createDeviceTokenSchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import type { DeviceTokensService } from "./deviceTokens.service";

// Painel: emitir/revogar "chaves de impressora" (tokens de dispositivo) para o print-client.
export function buildDeviceTokenRoutes(service: DeviceTokensService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    const auth = { preHandler: app.requirePanelAuth };
    const ownerOnly = { preHandler: [app.requirePanelAuth, app.requireOwner] };

    app.get("/api/device-tokens", auth, async (request) => {
      return { tokens: await service.list(request.user.storeId) };
    });

    app.post("/api/device-tokens", ownerOnly, async (request, reply) => {
      const parsed = createDeviceTokenSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return { token: await service.create(request.user, parsed.data) };
    });

    app.post("/api/device-tokens/:id/revoke", ownerOnly, async (request) => {
      const { id } = request.params as { id: string };
      await service.revoke(request.user, id);
      return { ok: true };
    });
  };
}
