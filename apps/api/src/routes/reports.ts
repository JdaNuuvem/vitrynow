import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";

const STORE_TIMEZONE = "America/Sao_Paulo";

// Relatório de vendas por período — autenticado pelo painel.
const reportRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/reports/summary", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId } = request.user;
    const query = request.query as { from?: string; to?: string };

    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.code(400).send({ error: "datas inválidas" });
    }
    // inclui o dia final inteiro
    const toInclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: {
        storeId,
        awaitingPayment: false,
        status: { not: "CANCELADO" },
        createdAt: { gte: from, lt: toInclusive },
      },
      include: { items: true, deliverer: true },
    });

    const orderCount = orders.length;
    const revenueCents = orders.reduce((sum, o) => sum + o.totalCents, 0);
    const discountCents = orders.reduce((sum, o) => sum + o.discountCents, 0);
    const averageTicketCents = orderCount > 0 ? Math.round(revenueCents / orderCount) : 0;

    const customerCount = new Set(
      orders.map((o) => o.customerPhone ?? o.customerName).filter((value): value is string => Boolean(value)),
    ).size;

    const dayAgg = new Map<string, { date: string; orderCount: number; revenueCents: number }>();
    for (const order of orders) {
      const date = order.createdAt.toLocaleDateString("en-CA", { timeZone: STORE_TIMEZONE });
      const entry = dayAgg.get(date) ?? { date, orderCount: 0, revenueCents: 0 };
      entry.orderCount += 1;
      entry.revenueCents += order.totalCents;
      dayAgg.set(date, entry);
    }
    const byDay = [...dayAgg.values()].sort((a, b) => a.date.localeCompare(b.date));

    const deliveryFeeCents = orders.reduce((sum, o) => sum + o.deliveryFeeCents, 0);
    const tipCents = orders.reduce((sum, o) => sum + o.tipCents, 0);

    const byPaymentMethod: Record<string, { count: number; revenueCents: number }> = {};
    for (const order of orders) {
      // Total zero (cupom cobriu tudo): atendido sem cobrança, em balde próprio (RN-CP-13); sem forma de pagamento e com total > 0 segue "não identificada".
      const bucket = order.totalCents === 0 ? "SEM_COBRANCA" : (order.paymentMethod ?? "NAO_IDENTIFICADO");
      byPaymentMethod[bucket] ??= { count: 0, revenueCents: 0 };
      byPaymentMethod[bucket].count += 1;
      byPaymentMethod[bucket].revenueCents += order.totalCents;
    }

    const byType: Record<string, { count: number; revenueCents: number }> = {};
    for (const order of orders) {
      byType[order.type] ??= { count: 0, revenueCents: 0 };
      byType[order.type].count += 1;
      byType[order.type].revenueCents += order.totalCents;
    }

    const productAgg = new Map<string, { productName: string; quantity: number; revenueCents: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        const key = item.productId ?? item.productName;
        const entry = productAgg.get(key) ?? { productName: item.productName, quantity: 0, revenueCents: 0 };
        entry.quantity += item.quantity;
        entry.revenueCents += item.unitPriceCents * item.quantity;
        productAgg.set(key, entry);
      }
    }
    const topProducts = [...productAgg.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10);

    const delivererAgg = new Map<string, { delivererName: string; orderCount: number; revenueCents: number }>();
    for (const order of orders) {
      if (!order.deliverer) continue;
      const entry = delivererAgg.get(order.deliverer.id) ?? {
        delivererName: order.deliverer.name,
        orderCount: 0,
        revenueCents: 0,
      };
      entry.orderCount += 1;
      entry.revenueCents += order.totalCents;
      delivererAgg.set(order.deliverer.id, entry);
    }
    const byDeliverer = [...delivererAgg.values()].sort((a, b) => b.orderCount - a.orderCount);

    const cashSessions = await prisma.cashSession.findMany({
      where: { storeId, openedAt: { gte: from, lt: toInclusive } },
      include: { movements: true },
    });
    const cashSummary = cashSessions.reduce(
      (acc, session) => {
        acc.sessionCount += 1;
        for (const movement of session.movements) {
          if (movement.type === "SUPRIMENTO") acc.suprimentosCents += movement.amountCents;
          else acc.sangriasCents += movement.amountCents;
        }
        return acc;
      },
      { sessionCount: 0, suprimentosCents: 0, sangriasCents: 0 },
    );

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      orderCount,
      revenueCents,
      discountCents,
      averageTicketCents,
      customerCount,
      deliveryFeeCents,
      tipCents,
      byPaymentMethod,
      byDay,
      byType,
      topProducts,
      byDeliverer,
      cashSummary,
    };
  });
};

export default reportRoutes;
