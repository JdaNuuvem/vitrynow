import multipart from "@fastify/multipart";
import type { FastifyPluginAsync } from "fastify";
import { DISH3D_MAX_PHOTO_BYTES, DISH3D_MAX_PHOTOS, dish3dSizeSchema } from "@meucardapio/shared-types";
import { getDish3d, listDish3d, removeDish3d, setDish3dPublished, setDish3dSize, startDish3d } from "../lib/dish3d";
import { requireFeature } from "../lib/subscription";
import { CodedError, useDomainErrors } from "../shared/errors";

// PRATO 3D (painel). Só o DONO: gerar gasta créditos e publicar muda o cardápio. Recurso do plano: `dish_3d`.
const dish3dRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);
  await app.register(multipart, { limits: { fileSize: DISH3D_MAX_PHOTO_BYTES, files: DISH3D_MAX_PHOTOS, fields: 0, parts: DISH3D_MAX_PHOTOS } });
  const owner = { preHandler: [app.requirePanelAuth, app.requireOwner, requireFeature("dish_3d")] };
  const actorOf = (user: { storeId: string; userId: string }) => ({ storeId: user.storeId, id: user.userId });

  app.get("/api/dish3d", owner, async (request) => listDish3d(request.user.storeId));

  app.get("/api/products/:id/3d", owner, async (request) => {
    const { id } = request.params as { id: string };
    return getDish3d(request.user.storeId, id);
  });

  // multipart com 1 a 4 fotos (campo "photos"); 202: a geração continua em segundo plano.
  app.post("/api/products/:id/3d", { ...owner, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!request.isMultipart()) throw new CodedError(415, "UNSUPPORTED_TYPE", "Envie o arquivo pelo formulário de envio.");
    const files: Buffer[] = [];
    for await (const part of request.files()) {
      const body = await part.toBuffer();
      if (part.file.truncated) throw new CodedError(413, "FILE_TOO_LARGE", "O arquivo passa de 8 MB. Envie um arquivo menor.");
      files.push(body);
    }
    const result = await startDish3d(actorOf(request.user), id, files);
    return reply.code(202).send(result);
  });

  app.post("/api/products/:id/3d/publish", owner, async (request) => {
    const { id } = request.params as { id: string };
    return setDish3dPublished(actorOf(request.user), id, true);
  });

  app.post("/api/products/:id/3d/unpublish", owner, async (request) => {
    const { id } = request.params as { id: string };
    return setDish3dPublished(actorOf(request.user), id, false);
  });

  // TAMANHO REAL: a largura do prato em cm; o modelo é reescrito nessa medida (o AR mostra o prato do tamanho de verdade)
  app.post("/api/products/:id/3d/size", owner, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = dish3dSizeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Informe a largura do prato em cm.", code: "VALIDATION_ERROR" });
    return setDish3dSize(actorOf(request.user), id, Math.round(parsed.data.widthCm * 10));
  });

  app.post("/api/products/:id/3d/remove", owner, async (request) => {
    const { id } = request.params as { id: string };
    return removeDish3d(actorOf(request.user), id);
  });
};

export default dish3dRoutes;
