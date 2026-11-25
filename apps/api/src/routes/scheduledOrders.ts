import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";

// API-40 — agenda da equipe: pedidos agendados ainda RETIDOS (fora do kanban até a liberação). Só leitura; aceitar ou cancelar
// usa as rotas normais do pedido (o motivo AGENDAMENTO_NAO_ATENDIDO já existe). Pedido aguardando PIX não aparece: ainda não é pedido.
const scheduledOrderRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/orders/scheduled", { preHandler: app.requirePanelAuth }, async (request) => {
    const { storeId } = request.user;
    const orders = await prisma.order.findMany({
      where: { storeId, held: true, awaitingPayment: false, status: { not: "CANCELADO" } },
      orderBy: { scheduledFor: "asc" },
      take: 500,
      select: {
        id: true, code: true, type: true, status: true, scheduledFor: true, customerName: true, totalCents: true, paymentMethod: true, paidAt: true, createdAt: true,
        items: { select: { productName: true, quantity: true } },
      },
    });
    return { orders };
  });
};

export default scheduledOrderRoutes;
