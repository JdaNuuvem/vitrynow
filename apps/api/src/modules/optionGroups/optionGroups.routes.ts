import { panelRoleSchema } from "@meucardapio/shared-types";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { optionGroupInputSchema, productOptionGroupsSchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import type { OptionGroupsService } from "./optionGroups.service";

// Painel: grupos de opções (B8) e vínculo com os produtos. Excluir grupo é só do dono (como categoria/produto).
export function buildOptionGroupRoutes(service: OptionGroupsService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    const auth = { preHandler: app.requirePanelAuth };
    const ownerOnly = {
      preHandler: [
        app.requirePanelAuth,
        async (request: FastifyRequest, reply: FastifyReply) => {
          if (request.user.role !== panelRoleSchema.enum.OWNER) return reply.code(403).send({ error: "Só o dono da loja pode fazer isso.", code: "FORBIDDEN_ROLE" });
        },
      ],
    };

    app.get("/api/catalog/option-groups", auth, async (request) => {
      return { groups: await service.listGroups(request.user.storeId) };
    });

    app.post("/api/catalog/option-groups", auth, async (request, reply) => {
      const parsed = optionGroupInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return reply.code(201).send(await service.createGroup(request.user, parsed.data));
    });

    app.post("/api/catalog/option-groups/:id", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = optionGroupInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return service.updateGroup(request.user, id, parsed.data);
    });

    app.post("/api/catalog/option-groups/:id/delete", ownerOnly, async (request) => {
      const { id } = request.params as { id: string };
      return { ok: true, ...(await service.deleteGroup(request.user, id)) };
    });

    app.get("/api/catalog/products/:id/option-groups", auth, async (request) => {
      const { id } = request.params as { id: string };
      return service.productGroups(request.user.storeId, id);
    });

    app.post("/api/catalog/products/:id/option-groups", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = productOptionGroupsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return service.setProductGroups(request.user, id, parsed.data.groupIds);
    });
  };
}
