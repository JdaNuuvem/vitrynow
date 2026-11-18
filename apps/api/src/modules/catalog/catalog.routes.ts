import type { FastifyPluginAsync } from "fastify";
import { createCategorySchema, createProductSchema, updateProductSchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import type { CatalogService } from "./catalog.service";

const updateCategorySchema = createCategorySchema.partial();

// Borda HTTP do catálogo: valida o corpo, chama o serviço e devolve o resultado.
// Autenticado pelo painel.
export function buildCatalogRoutes(service: CatalogService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    const auth = { preHandler: app.requirePanelAuth };

    app.get("/api/catalog/categories", auth, async (request) => {
      return { categories: await service.listCategories(request.user.storeId) };
    });

    app.post("/api/catalog/categories", auth, async (request, reply) => {
      const parsed = createCategorySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const category = await service.createCategory(request.user.storeId, parsed.data);
      return reply.code(201).send({ category });
    });

    app.post("/api/catalog/categories/:id", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateCategorySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return { category: await service.updateCategory(request.user.storeId, id, parsed.data) };
    });

    app.post("/api/catalog/categories/:id/delete", auth, async (request) => {
      const { id } = request.params as { id: string };
      await service.deleteCategory(request.user, id);
      return { ok: true };
    });

    app.post("/api/catalog/products", auth, async (request, reply) => {
      const parsed = createProductSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const product = await service.createProduct(request.user.storeId, parsed.data);
      return reply.code(201).send({ product });
    });

    app.post("/api/catalog/products/:id", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateProductSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return { product: await service.updateProduct(request.user.storeId, id, parsed.data) };
    });

    app.post("/api/catalog/products/:id/delete", auth, async (request) => {
      const { id } = request.params as { id: string };
      await service.deleteProduct(request.user, id);
      return { ok: true };
    });
  };
}
