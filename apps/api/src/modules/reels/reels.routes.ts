import multipart from "@fastify/multipart";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { reelUploadSchema } from "@meucardapio/shared-types";
import { logAudit } from "../../lib/audit";
import { reelsEnabled, REEL_LIMITS } from "../../lib/reelConfig";
import { requireFeature } from "../../lib/subscription";
import { useDomainErrors } from "../../shared/errors";
import { reelError, type ReelsService } from "./reels.service";

// Borda HTTP dos Reels (ADR-0021; rotas d1 e d2 do plano). Autenticado pelo painel; a loja vem SEMPRE da sessão.
// O Content-Type e o nome do arquivo enviados são ignorados: o tipo e a duração saem dos bytes (mp4Sniff no envio, ffprobe no worker).
// Duas travas antes de qualquer rota: chave geral `REELS_ENABLED` (DESLIGADA por padrão) e recurso `reels` no plano da loja;
// funcionário (STAFF) só entra se o plano também tem equipe (`multi_user`, PRO).
const MULTIPART_OVERHEAD = 64 * 1024;

export function buildReelsRoutes(service: ReelsService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    await app.register(multipart, { limits: { fileSize: REEL_LIMITS.maxUploadBytes, files: 1, fields: 2, parts: 3 } });

    const planGate = requireFeature("reels");
    const staffGate = requireFeature("multi_user");
    const gate = async (request: FastifyRequest, reply: FastifyReply) => {
      if (!reelsEnabled()) return reply.code(404).send({ error: "Recurso indisponível.", code: "REELS_DISABLED" });
      await planGate(request, reply);
      if (reply.sent) return reply;
      if (request.user.role === "STAFF") await staffGate(request, reply);
      return reply.sent ? reply : undefined;
    };
    const auth = { preHandler: [app.requirePanelAuth, gate] };

    app.post("/api/reels", { ...auth, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
      const parsed = reelUploadSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "informe o produto", code: "INVALID_PRODUCT" });
      if (!request.isMultipart()) return reply.code(415).send({ error: "envie multipart/form-data", code: "UNSUPPORTED_TYPE" });
      // Recusa ANTES de ler o corpo quando o tamanho declarado já passa do limite (CA-REEL-01: nada é gravado).
      const declared = Number(request.headers["content-length"]);
      if (Number.isFinite(declared) && declared > REEL_LIMITS.maxUploadBytes + MULTIPART_OVERHEAD) throw reelError("VIDEO_TOO_LARGE");

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "arquivo ausente", code: "FILE_REQUIRED" });
      const body = await file.toBuffer().catch((error: { code?: string }) => {
        if (error?.code === "FST_REQ_FILE_TOO_LARGE") throw reelError("VIDEO_TOO_LARGE"); // respeita limits.fileSize
        throw error;
      });
      if (file.file.truncated) throw reelError("VIDEO_TOO_LARGE");

      const userId = request.user.userId;
      const reel = await service.upload({ storeId: request.user.storeId, userId }, parsed.data.productId, body);
      // Auditoria: quem, produto, duração e tamanho. Nunca o conteúdo.
      logAudit({ storeId: request.user.storeId, userId, action: "reel.upload", targetType: "Reel", targetId: reel.id, metadata: { productId: parsed.data.productId, bytes: body.length, durationMs: reel.durationMs } });
      return reply.code(202).send({ reelId: reel.id, status: "PROCESSING" });
    });

    app.get("/api/reels", auth, async (request) => ({ reels: await service.list(request.user.storeId) }));

    app.get("/api/reels/:id", auth, async (request) => {
      const { id } = request.params as { id: string };
      return { reel: await service.get(request.user.storeId, id) };
    });
  };
}
