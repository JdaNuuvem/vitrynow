import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { createNoticeSchema } from "@meucardapio/shared-types";

function adminTokenMatches(provided: unknown): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Avisos da plataforma (widget de ajuda do painel). Leitura/marcação por usuário do painel;
// publicação só pela equipe da plataforma, via x-admin-token (ADMIN_TOKEN).
const noticeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/notices", { preHandler: app.requirePanelAuth }, async (request) => {
    const { userId } = request.user;
    const now = new Date();
    const notices = await prisma.notice.findMany({
      where: { publishedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { publishedAt: "desc" },
      take: 20,
      include: { reads: { where: { userId }, select: { userId: true } } },
    });
    const view = notices.map((notice) => ({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      imageUrl: notice.imageUrl,
      publishedAt: notice.publishedAt,
      read: notice.reads.length > 0,
    }));
    return { notices: view, unreadCount: view.filter((notice) => !notice.read).length };
  });

  app.post("/api/notices/:id/read", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const notice = await prisma.notice.findUnique({ where: { id } });
    if (!notice) return reply.code(404).send({ error: "aviso não encontrado" });

    await prisma.noticeRead.upsert({
      where: { noticeId_userId: { noticeId: id, userId: request.user.userId } },
      update: {},
      create: { noticeId: id, userId: request.user.userId },
    });
    return { ok: true };
  });

  app.post("/api/admin/notices", async (request, reply) => {
    if (!adminTokenMatches(request.headers["x-admin-token"])) return reply.code(401).send({ error: "não autorizado" });

    const parsed = createNoticeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { expiresAt, ...rest } = parsed.data;
    const notice = await prisma.notice.create({ data: { ...rest, expiresAt: expiresAt ? new Date(expiresAt) : null } });
    return reply.code(201).send({ notice });
  });

  app.post("/api/admin/notices/:id/delete", async (request, reply) => {
    if (!adminTokenMatches(request.headers["x-admin-token"])) return reply.code(401).send({ error: "não autorizado" });

    const { id } = request.params as { id: string };
    const result = await prisma.notice.deleteMany({ where: { id } });
    if (result.count === 0) return reply.code(404).send({ error: "aviso não encontrado" });
    return { ok: true };
  });
};

export default noticeRoutes;
