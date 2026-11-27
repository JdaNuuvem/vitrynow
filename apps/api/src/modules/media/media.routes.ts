import { panelRoleSchema } from "@meucardapio/shared-types";
import multipart from "@fastify/multipart";
import type { FastifyPluginAsync } from "fastify";
import { MAX_UPLOAD_BYTES } from "../../lib/imagePipeline";
import { useDomainErrors } from "../../shared/errors";
import type { MediaService } from "./media.service";

const KINDS = ["PRODUCT", "LOGO", "COVER"] as const;
type Kind = (typeof KINDS)[number];

// Borda HTTP do upload (API-18). Autenticado pelo painel (OWNER ou STAFF); a loja vem SEMPRE da sessão.
// O Content-Type e o nome do arquivo enviados são ignorados: o tipo sai dos bytes (imagePipeline).
export function buildMediaRoutes(service: MediaService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 2, parts: 3 } });
    const auth = { preHandler: app.requirePanelAuth };

    app.post(
      "/api/media/images",
      { ...auth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const kind = (request.query as { kind?: string }).kind as Kind;
        if (!KINDS.includes(kind)) return reply.code(400).send({ error: "Tipo de imagem não aceito. Use foto de produto, logo ou capa.", code: "INVALID_KIND" });
        // Logo e capa mudam a identidade da loja: só o dono (foto de produto: OWNER ou STAFF).
        if (kind !== "PRODUCT" && request.user.role !== panelRoleSchema.enum.OWNER) return reply.code(403).send({ error: "Só o dono da loja pode fazer isso.", code: "FORBIDDEN_ROLE" });
        if (!request.isMultipart()) return reply.code(415).send({ error: "Envie o arquivo pelo formulário de envio.", code: "UNSUPPORTED_TYPE" });

        const file = await request.file();
        if (!file) return reply.code(400).send({ error: "Escolha um arquivo para enviar.", code: "FILE_REQUIRED" });
        const body = await file.toBuffer(); // respeita limits.fileSize
        if (file.file.truncated) return reply.code(413).send({ error: "O arquivo passa de 8 MB. Envie um arquivo menor.", code: "FILE_TOO_LARGE" });

        const image = await service.upload(request.user.storeId, kind, body);
        return reply.code(201).send({ image });
      },
    );

    app.post("/api/media/images/:id/delete", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request) => {
      const { id } = request.params as { id: string };
      await service.remove(request.user.storeId, id);
      return { ok: true };
    });
  };
}
