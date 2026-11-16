import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { buildPrintableOrder } from "../lib/printable";

// Rotas consumidas pelo print-client (C#), autenticadas por token de dispositivo.
// Equivalentes funcionais ao listarPedidos/pedidosImpressos/textSaleNew do original,
// mas contra o nosso backend e com JSON estruturado em vez de HTML pronto.
const deviceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/device/orders/pending", { preHandler: app.requireDeviceAuth }, async (request) => {
    const storeId = request.deviceStoreId!;
    const orders = await prisma.order.findMany({
      where: { storeId, printedAt: null, status: { not: "CANCELADO" }, awaitingPayment: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, code: true },
    });
    return { orders };
  });

  app.get("/api/device/orders/:id/printable", { preHandler: app.requireDeviceAuth }, async (request, reply) => {
    const storeId = request.deviceStoreId!;
    const { id } = request.params as { id: string };
    const order = await prisma.order.findFirst({ where: { id, storeId } });
    if (!order) return reply.code(404).send({ error: "pedido não encontrado" });

    const printable = await buildPrintableOrder(id);
    return { order: printable };
  });

  app.post("/api/device/orders/:id/printed", { preHandler: app.requireDeviceAuth }, async (request, reply) => {
    const storeId = request.deviceStoreId!;
    const { id } = request.params as { id: string };
    const order = await prisma.order.findFirst({ where: { id, storeId } });
    if (!order) return reply.code(404).send({ error: "pedido não encontrado" });

    await prisma.order.update({ where: { id }, data: { printedAt: new Date() } });
    return { ok: true };
  });
};

export default deviceRoutes;
