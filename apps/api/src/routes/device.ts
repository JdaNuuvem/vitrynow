import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { buildPrintableOrder } from "../lib/printable";
import { loadPrintMode } from "../modules/printJobs/printMode.service";

// Rotas consumidas pelo print-client (C#), autenticadas por token de dispositivo.
// Equivalentes funcionais ao listarPedidos/pedidosImpressos/textSaleNew do original,
// mas contra o nosso backend e com JSON estruturado em vez de HTML pronto.
const deviceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/device/orders/pending", { preHandler: app.requireDeviceAuth }, async (request) => {
    const storeId = request.deviceStoreId!;
    // Em QUEUE a lista legada vem VAZIA: quem imprime é a fila (o servidor impede a impressão em dobro).
    if ((await loadPrintMode(prisma, storeId)) === "QUEUE") return { orders: [] };
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
    if ((await loadPrintMode(prisma, storeId)) === "QUEUE") return reply.code(409).send({ error: "Esta loja imprime pela fila.", code: "MODE_QUEUE" });
    const order = await prisma.order.findFirst({ where: { id, storeId } });
    if (!order) return reply.code(404).send({ error: "pedido não encontrado" });

    const printable = await buildPrintableOrder(id);
    return { order: printable };
  });

  app.post("/api/device/orders/:id/printed", { preHandler: app.requireDeviceAuth }, async (request, reply) => {
    const storeId = request.deviceStoreId!;
    const { id } = request.params as { id: string };
    if ((await loadPrintMode(prisma, storeId)) === "QUEUE") return reply.code(409).send({ error: "Esta loja imprime pela fila.", code: "MODE_QUEUE" });
    const order = await prisma.order.findFirst({ where: { id, storeId } });
    if (!order) return reply.code(404).send({ error: "pedido não encontrado" });

    // `printedAt` do pedido E o job ORDER_KITCHEN dele fecham NA MESMA transação: o job do pedido que o legado imprimiu não
    // fica PENDING (senão a virada para a fila o reimprimiria; achado do Ritchie, ADR-0004 §8.13a).
    const now = new Date();
    await prisma.$transaction([
      prisma.order.update({ where: { id }, data: { printedAt: now } }),
      prisma.printJob.updateMany({
        where: { storeId, orderId: id, kind: "ORDER_KITCHEN", status: { in: ["PENDING", "CLAIMED"] } },
        data: { status: "PRINTED", printedAt: now, ackStatus: "PRINTED", leaseUntil: null },
      }),
    ]);
    return { ok: true };
  });
};

export default deviceRoutes;
