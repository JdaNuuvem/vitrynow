import type { FastifyPluginAsync } from "fastify";
import { createCouponSchema, updateCouponSchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import type { CouponsService } from "./coupons.service";

// CRUD de cupons — autenticado pelo painel.
export function buildCouponRoutes(service: CouponsService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    const auth = { preHandler: app.requirePanelAuth };

    app.get("/api/coupons", auth, async (request) => {
      return { coupons: await service.list(request.user.storeId) };
    });

    app.post("/api/coupons", auth, async (request, reply) => {
      const parsed = createCouponSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const coupon = await service.create(request.user.storeId, parsed.data);
      return reply.code(201).send({ coupon });
    });

    app.post("/api/coupons/:id", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateCouponSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return { coupon: await service.update(request.user.storeId, id, parsed.data) };
    });

    app.post("/api/coupons/:id/delete", auth, async (request) => {
      const { id } = request.params as { id: string };
      await service.delete(request.user, id);
      return { ok: true };
    });
  };
}
