import type { FastifyPluginAsync } from "fastify";
import { createCategorySchema, createProductSchema, moveProductsSchema, reorderCategoriesSchema, reorderProductsSchema, setSoldOutSchema, updateProductSchema } from "@meucardapio/shared-types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { useDomainErrors } from "../../shared/errors";
import type { CatalogService } from "./catalog.service";

const updateCategorySchema = createCategorySchema.partial();

// Borda HTTP do catálogo: valida o corpo, chama o serviço e devolve o resultado.
// Autenticado pelo painel.
export function buildCatalogRoutes(service: CatalogService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    const auth = { preHandler: app.requirePanelAuth };
    // Excluir categoria/produto é só do dono (RN-CT-18, CA-CT-13). Com `code` para a tela; trocar por
    // app.requireOwner quando ele também devolver `code: FORBIDDEN_ROLE`.
    const ownerOnly = {
      preHandler: [
        app.requirePanelAuth,
        async (request: FastifyRequest, reply: FastifyReply) => {
          if (request.user.role !== "OWNER") return reply.code(403).send({ error: "ação restrita ao dono da loja", code: "FORBIDDEN_ROLE" });
        },
      ],
    };

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

    app.post("/api/catalog/categories/reorder", auth, async (request, reply) => {
      const parsed = reorderCategoriesSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      await service.reorderCategories(request.user.storeId, parsed.data.ids);
      return { ok: true };
    });

    app.post("/api/catalog/categories/:id/move-products", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = moveProductsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return service.moveProducts(request.user, id, parsed.data.toCategoryId);
    });

    app.post("/api/catalog/categories/:id/delete", ownerOnly, async (request) => {
      const { id } = request.params as { id: string };
      await service.deleteCategory(request.user, id);
      return { ok: true };
    });

    app.post("/api/catalog/products", auth, async (request, reply) => {
      const parsed = createProductSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const product = await service.createProduct(request.user, parsed.data);
      return reply.code(201).send({ product });
    });

    app.post("/api/catalog/products/:id", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateProductSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return { product: await service.updateProduct(request.user, id, parsed.data) };
    });

    // API-17 (B11): "Esgotado hoje" em 1 toque; OWNER e STAFF (CA-B11-05); grava auditoria (RN-B11-07).
    app.post("/api/catalog/products/:id/sold-out", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = setSoldOutSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return { product: await service.setSoldOut(request.user, id, parsed.data) };
    });

    app.post("/api/catalog/products/reorder", auth, async (request, reply) => {
      const parsed = reorderProductsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      await service.reorderProducts(request.user.storeId, parsed.data.categoryId, parsed.data.ids);
      return { ok: true };
    });

    app.post("/api/catalog/products/:id/delete", ownerOnly, async (request) => {
      const { id } = request.params as { id: string };
      await service.deleteProduct(request.user, id);
      return { ok: true };
    });
  };
}
