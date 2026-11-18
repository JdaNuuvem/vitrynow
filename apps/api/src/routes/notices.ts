import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";

// Avisos da plataforma (widget de ajuda do painel). Leitura/marcação por usuário do painel;
// publicação pelo back-office (routes/platform.ts); o x-admin-token foi aposentado (API-25).
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
};

export default noticeRoutes;
