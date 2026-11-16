import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { orderStatusSchema } from "@meucardapio/shared-types";
import { publishToStore } from "../realtime/hub";
import { refundPayment } from "../lib/mercadopago";
import { logAudit } from "../lib/audit";
import { findOwnedOrNotFound } from "../lib/tenant";
import { requireMfa } from "../lib/mfaGate";

// Rotas do painel (kanban) — autenticadas por cookie de sessão.
const orderRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/orders", { preHandler: app.requirePanelAuth }, async (request) => {
    const { storeId } = request.user;
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);

    const orders = await prisma.order.findMany({
      where: { storeId, awaitingPayment: false },
      orderBy: { createdAt: "desc" },
      include: { items: true, deliverer: true, payment: true },
      take: limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    });
    const nextCursor = orders.length === limit ? orders[orders.length - 1].id : null;
    return { orders, nextCursor };
  });

  app.post("/api/orders/:id/status", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = orderStatusSchema.safeParse((request.body as { status?: unknown })?.status);
    if (!parsed.success) return reply.code(400).send({ error: "status inválido" });

    const order = await findOwnedOrNotFound(
      reply,
      () => prisma.order.findFirst({ where: { id, storeId } }),
      "pedido não encontrado",
    );
    if (!order) return;

    await prisma.order.update({
      where: { id },
      data: { status: parsed.data, statusHistory: { create: { status: parsed.data } } },
    });
    publishToStore(storeId, { type: "order.updated", orderId: id });
    return { ok: true };
  });

  // Estorno de pagamento PIX já aprovado — restrito a OWNER (movimenta dinheiro de verdade).
  app.post("/api/orders/:id/refund", { preHandler: [app.requirePanelAuth, app.requireOwner, requireMfa("refund")] }, async (request, reply) => {
    const { storeId } = request.user;
    const { id } = request.params as { id: string };

    const order = await findOwnedOrNotFound(
      reply,
      () => prisma.order.findFirst({ where: { id, storeId }, include: { payment: true } }),
      "pedido não encontrado",
    );
    if (!order) return;
    if (!order.payment || order.payment.status !== "APROVADO" || !order.payment.providerPaymentId) {
      return reply.code(409).send({ error: "pedido não tem pagamento aprovado para estornar" });
    }

    try {
      await refundPayment(order.payment.providerPaymentId);
    } catch (error) {
      app.log.error(error);
      return reply.code(502).send({ error: "não foi possível estornar no Mercado Pago, tente novamente" });
    }

    await prisma.$transaction([
      prisma.payment.update({ where: { id: order.payment.id }, data: { status: "REEMBOLSADO" } }),
      prisma.order.update({
        where: { id: order.id },
        data: { status: "CANCELADO", statusHistory: { create: { status: "CANCELADO" } } },
      }),
    ]);
    publishToStore(storeId, { type: "order.updated", orderId: id });
    logAudit({ storeId, userId: request.user.userId, action: "order.refund", targetType: "Order", targetId: id });
    return { ok: true };
  });
};

export default orderRoutes;
