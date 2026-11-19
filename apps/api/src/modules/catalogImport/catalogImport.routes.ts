import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { IMPORT_MAX_BYTES, importConfirmSchema, importPreviewInputSchema, importTemplateQuerySchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import type { CatalogImportService } from "./catalogImport.service";

// Importação assistida de produtos (IMP-1; e1..e3). Só OWNER (STAFF não vê: RN-IMP2 §3). Escrita = `blocked` na Consulta/Suspensão.
export function buildCatalogImportRoutes(service: CatalogImportService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    const ownerOnly = {
      preHandler: [
        app.requirePanelAuth,
        async (request: FastifyRequest, reply: FastifyReply) => {
          if (request.user.role !== "OWNER") return reply.code(403).send({ error: "ação restrita ao dono da loja", code: "FORBIDDEN_ROLE" });
        },
      ],
    };

    app.get("/api/catalog/import/template", ownerOnly, async (request, reply) => {
      const parsed = importTemplateQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Não reconhecemos este formato. Use csv ou json.", code: "IMPORT_FORMAT_INVALID" });
      const file = service.template(parsed.data.format);
      return reply.header("Content-Type", file.contentType).header("Content-Disposition", `attachment; filename="${file.filename}"`).header("Cache-Control", "no-store").send(file.body);
    });

    app.get("/api/catalog/import/guide", ownerOnly, async () => service.guide());

    // Valida e mostra; não grava produto. O corpo pode chegar a 2 MB (limite da regra RN-IMP2-02, conferido de novo no serviço).
    app.post("/api/catalog/import/preview", { ...ownerOnly, bodyLimit: IMPORT_MAX_BYTES + 4096 }, async (request, reply) => {
      const parsed = importPreviewInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Não reconhecemos este arquivo. Use CSV ou JSON.", code: "IMPORT_FORMAT_INVALID" });
      return reply.code(201).send(await service.preview(request.user, parsed.data));
    });

    app.get("/api/catalog/import/:batchId", ownerOnly, async (request) => {
      const { batchId } = request.params as { batchId: string };
      return service.get(request.user.storeId, batchId);
    });

    app.post("/api/catalog/import/:batchId/confirm", ownerOnly, async (request, reply) => {
      const { batchId } = request.params as { batchId: string };
      const parsed = importConfirmSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return service.confirm(request.user, batchId, parsed.data);
    });

    app.post("/api/catalog/import/:batchId/discard", ownerOnly, async (request) => {
      const { batchId } = request.params as { batchId: string };
      return service.discard(request.user, batchId);
    });
  };
}
