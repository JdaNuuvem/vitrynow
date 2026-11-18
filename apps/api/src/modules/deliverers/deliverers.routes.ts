import type { FastifyPluginAsync } from "fastify";
import { assignDelivererSchema, createDelivererSchema, updateDelivererSchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import type { DeliverersService } from "./deliverers.service";

// CRUD de entregadores + atribuição a pedidos de delivery — autenticado pelo painel.
export function buildDelivererRoutes(service: DeliverersService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    const auth = { preHandler: app.requirePanelAuth };
    const ownerOnly = { preHandler: [app.requirePanelAuth, app.requireOwner] };

    app.get("/api/deliverers", auth, async (request) => {
      return { deliverers: await service.list(request.user.storeId) };
    });

    app.post("/api/deliverers", auth, async (request, reply) => {
      const parsed = createDelivererSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const deliverer = await service.create(request.user.storeId, parsed.data);
      return reply.code(201).send({ deliverer });
    });

    app.post("/api/deliverers/:id", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateDelivererSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return { deliverer: await service.update(request.user.storeId, id, parsed.data) };
    });

    app.post("/api/deliverers/:id/delete", ownerOnly, async (request) => {
      const { id } = request.params as { id: string };
      await service.delete(request.user, id);
      return { ok: true };
    });

    app.post("/api/orders/:id/deliverer", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = assignDelivererSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      await service.assignToOrder(request.user.storeId, id, parsed.data.delivererId ?? null);
      return { ok: true };
    });
  };
}
