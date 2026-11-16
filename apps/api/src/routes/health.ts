import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ status: "error", error: "banco de dados inacessível" });
    }
    return { status: "ok", time: new Date().toISOString() };
  });
};

export default healthRoutes;
