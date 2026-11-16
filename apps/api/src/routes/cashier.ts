import type { FastifyPluginAsync } from "fastify";
import { Prisma, prisma } from "@meucardapio/db";
import { closeCashSessionSchema, createCashMovementSchema, openCashSessionSchema } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { computeCashSummary } from "../lib/cashier";
import { findOwnedOrNotFound } from "../lib/tenant";

const STALE_AFTER_HOURS = 20;

type SessionWithMovements = Prisma.CashSessionGetPayload<{ include: { movements: true } }>;

// Vendas do período do caixa: tudo o que foi pedido (e já confirmado/pago) entre a abertura
// e o fechamento — ou até agora, se o caixa ainda está aberto.
async function summarizeSession(storeId: string, session: SessionWithMovements) {
  const orders = await prisma.order.findMany({
    where: {
      storeId,
      awaitingPayment: false,
      createdAt: { gte: session.openedAt, ...(session.closedAt ? { lte: session.closedAt } : {}) },
    },
    select: { type: true, status: true, totalCents: true, deliveryFeeCents: true, tipCents: true, paymentMethod: true },
  });
  return computeCashSummary(session, orders);
}

// Caixa do balcão: abertura/fechamento + movimentações manuais (suprimento/sangria).
// Saldo esperado = abertura + vendas em dinheiro + suprimentos - sangrias (ver lib/cashier.ts).
const cashierRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/cashier/current", { preHandler: app.requirePanelAuth }, async (request) => {
    const { storeId } = request.user;
    const session = await prisma.cashSession.findFirst({
      where: { storeId, closedAt: null },
      include: { movements: { orderBy: { createdAt: "desc" } } },
    });
    if (!session) return { session: null };

    const summary = await summarizeSession(storeId, session);
    const openForHours = (Date.now() - session.openedAt.getTime()) / (1000 * 60 * 60);
    const stale = openForHours > STALE_AFTER_HOURS;
    return { session, summary, expectedBalanceCents: summary.expectedCents, openForHours, stale };
  });

  app.get("/api/cashier/sessions/:id/summary", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId } = request.user;
    const { id } = request.params as { id: string };
    const session = await findOwnedOrNotFound(
      reply,
      () => prisma.cashSession.findFirst({ where: { id, storeId }, include: { movements: { orderBy: { createdAt: "desc" } } } }),
      "caixa não encontrado",
    );
    if (!session) return;
    return { session, summary: await summarizeSession(storeId, session) };
  });

  app.post("/api/cashier/open", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = openCashSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    // Sem SELECT prévio: o índice único parcial (storeId WHERE closedAt IS NULL) é quem
    // garante atomicidade — dois cliques/abas simultâneos não abrem dois caixas (um deles
    // recebe a violação de unicidade e vira 409 em vez de corromper o estado).
    try {
      const session = await prisma.cashSession.create({
        data: {
          storeId,
          openedByUserId: userId,
          openingBalanceCents: parsed.data.openingBalanceCents,
          openingNotes: parsed.data.notes || null,
        },
      });
      return reply.code(201).send({ session });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ error: "já existe um caixa aberto" });
      }
      throw error;
    }
  });

  app.post("/api/cashier/close", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = closeCashSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const session = await prisma.cashSession.findFirst({ where: { storeId, closedAt: null }, include: { movements: true } });
    if (!session) return reply.code(404).send({ error: "não há caixa aberto" });

    const closedAt = new Date();
    const summary = await summarizeSession(storeId, { ...session, closedAt });
    const differenceCents = parsed.data.closingBalanceCents - summary.expectedCents;

    const updated = await prisma.cashSession.update({
      where: { id: session.id },
      data: {
        closedAt,
        closedByUserId: userId,
        closingBalanceCents: parsed.data.closingBalanceCents,
        closingNotes: parsed.data.notes || null,
        expectedClosingCents: summary.expectedCents,
        differenceCents,
      },
    });
    logAudit({
      storeId,
      userId,
      action: "cashier.close",
      targetType: "CashSession",
      targetId: session.id,
      metadata: { closingBalanceCents: parsed.data.closingBalanceCents, expectedCents: summary.expectedCents, differenceCents },
    });
    return { session: updated, summary };
  });

  app.post("/api/cashier/movements", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId } = request.user;
    const parsed = createCashMovementSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const session = await prisma.cashSession.findFirst({ where: { storeId, closedAt: null } });
    if (!session) return reply.code(409).send({ error: "não há caixa aberto" });

    const movement = await prisma.cashMovement.create({
      data: { cashSessionId: session.id, ...parsed.data },
    });
    return reply.code(201).send({ movement });
  });

  app.get("/api/cashier/sessions", { preHandler: app.requirePanelAuth }, async (request) => {
    const { storeId } = request.user;
    const sessions = await prisma.cashSession.findMany({
      where: { storeId, closedAt: { not: null } },
      orderBy: { openedAt: "desc" },
      take: 50,
    });
    return { sessions };
  });
};

export default cashierRoutes;
