import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { campaignRevisionSchema, campaignSaveSchema } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { getCampaign, publish, saveDraft, unpublish } from "../modules/campaign/campaign.service";
import { CodedError } from "../shared/errors";

// Campanha do cardápio: só o dono (OWNER) da loja da sessão; o escopo é SEMPRE o `storeId` da sessão (nunca do corpo). Escritas: classe `blocked` no routePolicy.
// Auditoria sem conteúdo (título, texto e imagem não vão para o log): só a ação e a revisão resultante.
const menuCampaignRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.requirePanelAuth, app.requireOwner] };
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof CodedError) return reply.code(error.statusCode).send({ error: error.message, code: error.code });
    throw error;
  };

  app.get("/api/store/menu-campaign", guard, async (request) => getCampaign(request.user.storeId));

  app.put("/api/store/menu-campaign", guard, async (request, reply) => {
    const parsed = campaignSaveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Conteúdo da campanha inválido.", code: "VALIDATION_ERROR" });
    try {
      const state = await saveDraft(request.user.storeId, parsed.data.revision, parsed.data.draft);
      logAudit({ storeId: request.user.storeId, userId: request.user.userId, action: "store.campaign_save", targetType: "Store", targetId: request.user.storeId, metadata: { revision: state.revision } });
      return state;
    } catch (error) {
      return fail(reply, error);
    }
  });

  for (const [name, run] of [["publish", publish], ["unpublish", unpublish]] as const) {
    app.post(`/api/store/menu-campaign/${name}`, guard, async (request, reply) => {
      const parsed = campaignRevisionSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Revisão inválida.", code: "VALIDATION_ERROR" });
      try {
        const state = await run(request.user.storeId, parsed.data.revision);
        logAudit({ storeId: request.user.storeId, userId: request.user.userId, action: `store.campaign_${name}`, targetType: "Store", targetId: request.user.storeId, metadata: { revision: state.revision } });
        return state;
      } catch (error) {
        return fail(reply, error);
      }
    });
  }
};

export default menuCampaignRoutes;
