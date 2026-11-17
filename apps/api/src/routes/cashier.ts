import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { Prisma, prisma } from "@meucardapio/db";
import { closeCashSessionSchema, createCashMovementSchema, openCashSessionSchema, setCashStaffLimitSchema } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { computeCashSummary } from "../lib/cashier";
import { CASH_TOLERANCE_CENTS, closePreview, evaluateClose, validateMovementReason } from "../lib/cashRules";
import { findOwnedOrNotFound } from "../lib/tenant";
import { CodedError, useDomainErrors } from "../shared/errors";

const STALE_AFTER_HOURS = 20;

type Db = Prisma.TransactionClient;
type SessionWithMovements = Prisma.CashSessionGetPayload<{ include: { movements: true } }>;

// Vendas do período do caixa: tudo o que foi pedido (e já confirmado/pago) entre a abertura
// e o fechamento — ou até agora, se o caixa ainda está aberto.
async function summarizeSession(db: Db | typeof prisma, storeId: string, session: SessionWithMovements) {
  const orders = await db.order.findMany({
    where: {
      storeId,
      awaitingPayment: false,
      createdAt: { gte: session.openedAt, ...(session.closedAt ? { lte: session.closedAt } : {}) },
    },
    select: { type: true, status: true, totalCents: true, deliveryFeeCents: true, tipCents: true, paymentMethod: true },
  });
  return computeCashSummary(session, orders);
}

// A API devolve a movimentação com TIPO, valor, motivo, PAPEL e HORA de quem lançou: nunca o id do usuário nem o e-mail (CA-CX-22).
const movementView = (m: SessionWithMovements["movements"][number]) => ({
  id: m.id,
  type: m.type,
  amountCents: m.amountCents,
  notes: m.notes,
  reason: m.reason,
  reasonText: m.reasonText,
  createdByRole: m.createdByRole,
  createdAt: m.createdAt,
});
const sessionView = (s: SessionWithMovements) => ({ ...s, movements: s.movements.map(movementView) });

// Histórico: a diferença e o motivo de cada fechamento são do OWNER (RN-CX-22); o STAFF vê o resumo do turno, não a diferença.
const closedSessionView = (s: Prisma.CashSessionGetPayload<object>, role: "OWNER" | "STAFF") => {
  const { summarySnapshot: _snapshot, ...rest } = s;
  void _snapshot;
  if (role === "OWNER") return rest;
  const { differenceCents: _d, closeReason: _r, closeReasonText: _t, ...masked } = rest;
  void _d;
  void _r;
  void _t;
  return masked;
};

// Caixa do balcão: abertura/fechamento + movimentações manuais (suprimento/sangria).
// Saldo esperado = abertura + vendas em dinheiro + suprimentos - sangrias (ver lib/cashier.ts).
// CONCORRÊNCIA: abrir/mover/fechar travam a LINHA do caixa (FOR UPDATE) antes de ler o saldo ou gravar: duas sangrias simultâneas nunca
// passam juntas do saldo e dois fechamentos geram UM fechamento (RN-CX-10, RN-CX-18).
const cashierRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);

  app.get("/api/cashier/current", { preHandler: app.requirePanelAuth }, async (request) => {
    const { storeId, role } = request.user;
    const session = await prisma.cashSession.findFirst({
      where: { storeId, closedAt: null },
      include: { movements: { orderBy: { createdAt: "desc" } } },
    });
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { cashStaffWithdrawalLimitCents: true } });
    const rules = { toleranceCents: CASH_TOLERANCE_CENTS, staffWithdrawalLimitCents: role === "OWNER" ? (store?.cashStaffWithdrawalLimitCents ?? 0) : undefined };
    if (!session) return { session: null, ...rules };

    const summary = await summarizeSession(prisma, storeId, session);
    const openForHours = (Date.now() - session.openedAt.getTime()) / (1000 * 60 * 60);
    const stale = openForHours > STALE_AFTER_HOURS;
    return { session: sessionView(session), summary, expectedBalanceCents: summary.expectedCents, openForHours, stale, ...rules };
  });

  // Prévia do fechamento: a tela mostra "Sobrou/Faltou" e se o motivo é obrigatório SEM duplicar a regra (CA-CX-19).
  app.get("/api/cashier/close-preview", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId } = request.user;
    const raw = (request.query as { countedCents?: string }).countedCents;
    const counted = raw === undefined || raw === "" ? NaN : Number(raw);
    if (!Number.isInteger(counted) || counted < 0) return reply.code(400).send({ error: "Informe o valor contado.", code: "CASH_COUNTED_REQUIRED" });
    const session = await prisma.cashSession.findFirst({ where: { storeId, closedAt: null }, include: { movements: true } });
    if (!session) return reply.code(404).send({ error: "não há caixa aberto", code: "CASH_REQUIRED" });
    const summary = await summarizeSession(prisma, storeId, session);
    return closePreview(summary.expectedCents, counted);
  });

  app.get("/api/cashier/sessions/:id/summary", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, role } = request.user;
    const { id } = request.params as { id: string };
    const session = await findOwnedOrNotFound(
      reply,
      () => prisma.cashSession.findFirst({ where: { id, storeId }, include: { movements: { orderBy: { createdAt: "desc" } } } }),
      "caixa não encontrado",
    );
    if (!session) return;
    // Caixa FECHADO: devolve o retrato CONGELADO no fechamento (não recalcula; pedidos cancelados depois não mudam o histórico, RN-CX-15).
    const summary = session.closedAt && session.summarySnapshot ? session.summarySnapshot : await summarizeSession(prisma, storeId, session);
    const view = session.closedAt ? { ...closedSessionView(session, role), movements: session.movements.map(movementView) } : sessionView(session);
    return { session: view, summary };
  });

  app.post("/api/cashier/open", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId, role } = request.user;
    const parsed = openCashSessionSchema.safeParse(request.body);
    // Abertura OBRIGATÓRIA: sem o campo, 400 (a tela não pré-preenche "R$ 0,00"); zero digitado de propósito vale.
    if (!parsed.success) return reply.code(400).send({ error: "Informe o valor de abertura.", code: "CASH_COUNTED_REQUIRED", fields: parsed.error.flatten().fieldErrors });

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
      logAudit({ storeId, userId, action: "cashier.open", targetType: "CashSession", targetId: session.id, metadata: { openingBalanceCents: session.openingBalanceCents, role } });
      return reply.code(201).send({ session });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ error: "já existe um caixa aberto", code: "CASH_ALREADY_OPEN" });
      }
      throw error;
    }
  });

  app.post("/api/cashier/close", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId, role } = request.user;
    const parsed = closeCashSessionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    // Valor contado OBRIGATÓRIO: ausente ou nulo NUNCA vira 0 por omissão (0 digitado de propósito é válido e gera diferença grande, que pede motivo).
    const counted = parsed.data.closingBalanceCents;
    if (counted === undefined || counted === null) {
      return reply.code(400).send({ error: "Informe o valor contado.", code: "CASH_COUNTED_REQUIRED" });
    }

    const open = await prisma.cashSession.findFirst({ where: { storeId, closedAt: null }, select: { id: true } });
    if (!open) return reply.code(404).send({ error: "não há caixa aberto", code: "CASH_REQUIRED" });

    // Fechamento ATÔMICO e ÚNICO: trava a linha do caixa; quem chega depois do primeiro fechamento vê `closedAt` preenchido ⇒ 409.
    // O retrato do resumo é calculado e gravado DENTRO da mesma transação (nenhuma movimentação entra no meio).
    const result = await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ closedAt: Date | null }[]>`SELECT "closedAt" FROM "CashSession" WHERE "id" = ${open.id} AND "storeId" = ${storeId} FOR UPDATE`;
        if (!rows[0]) throw new CodedError(404, "CASH_REQUIRED", "não há caixa aberto");
        if (rows[0].closedAt) throw new CodedError(409, "CASH_ALREADY_CLOSED", "Este caixa já foi fechado.");
        const session = await tx.cashSession.findUniqueOrThrow({ where: { id: open.id }, include: { movements: true } });
        const closedAt = new Date();
        const summary = await summarizeSession(tx, storeId, { ...session, closedAt });
        const differenceCents = counted - summary.expectedCents;
        const verdict = evaluateClose(differenceCents, parsed.data.reason, parsed.data.reasonText);
        const updated = await tx.cashSession.update({
          where: { id: session.id },
          data: {
            closedAt,
            closedByUserId: userId,
            closedByRole: role,
            closingBalanceCents: counted,
            closingNotes: parsed.data.notes || null,
            expectedClosingCents: summary.expectedCents,
            differenceCents,
            closeReason: verdict.reason,
            closeReasonText: verdict.reasonText,
            summarySnapshot: JSON.parse(JSON.stringify(summary)) as Prisma.InputJsonValue,
          },
        });
        return { updated, summary, verdict, differenceCents };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    // Auditoria: esperado, contado, diferença e o CÓDIGO do motivo; nunca o texto livre (ADR-0014).
    logAudit({
      storeId,
      userId,
      action: "cashier.close",
      targetType: "CashSession",
      targetId: result.updated.id,
      metadata: { closingBalanceCents: counted, expectedCents: result.summary.expectedCents, differenceCents: result.differenceCents, reason: result.verdict.reason, role },
    });
    return { session: closedSessionView(result.updated, role), summary: result.summary, differenceCents: result.differenceCents, toleranceCents: CASH_TOLERANCE_CENTS };
  });

  app.post("/api/cashier/movements", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId, role } = request.user;
    const parsed = createCashMovementSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const { type, amountCents } = parsed.data;
    // Motivo ANTES de tocar no banco: sem motivo (ou de outro tipo) nada é criado (CA-CX-20/21).
    const { reason, reasonText } = validateMovementReason(type, parsed.data.reason, parsed.data.reasonText);

    const open = await prisma.cashSession.findFirst({ where: { storeId, closedAt: null }, select: { id: true } });
    if (!open) return reply.code(409).send({ error: "não há caixa aberto", code: "CASH_REQUIRED" });

    const movement = await prisma.$transaction(
      async (tx) => {
        // Trava o caixa: duas sangrias simultâneas se enfileiram e a segunda enxerga o saldo já reduzido (RN-CX-10).
        const rows = await tx.$queryRaw<{ closedAt: Date | null }[]>`SELECT "closedAt" FROM "CashSession" WHERE "id" = ${open.id} AND "storeId" = ${storeId} FOR UPDATE`;
        if (!rows[0] || rows[0].closedAt) throw new CodedError(409, "CASH_REQUIRED", "não há caixa aberto");
        if (type === "SANGRIA") {
          if (role !== "OWNER") {
            const store = await tx.store.findUniqueOrThrow({ where: { id: storeId }, select: { cashStaffWithdrawalLimitCents: true } });
            if (amountCents > store.cashStaffWithdrawalLimitCents) {
              throw new CodedError(403, "FORBIDDEN_ROLE", "Peça ao dono para autorizar esta sangria.");
            }
          }
          const session = await tx.cashSession.findUniqueOrThrow({ where: { id: open.id }, include: { movements: true } });
          const summary = await summarizeSession(tx, storeId, session);
          if (amountCents > summary.expectedCents) {
            throw new CodedError(409, "CASH_WITHDRAWAL_EXCEEDS_BALANCE", `A sangria passa do dinheiro em caixa (R$ ${(summary.expectedCents / 100).toFixed(2).replace(".", ",")}).`, {
              balanceCents: summary.expectedCents,
            });
          }
        }
        return tx.cashMovement.create({
          data: { cashSessionId: open.id, type, amountCents, notes: parsed.data.notes ?? null, reason, reasonText, createdByUserId: userId, createdByRole: role },
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    // Auditoria: tipo, valor e o CÓDIGO do motivo; o texto livre do `OUTRO` NÃO vai para o log.
    logAudit({ storeId, userId, action: "cashier.movement", targetType: "CashMovement", targetId: movement.id, metadata: { type, amountCents, reason, role } });
    return reply.code(201).send({ movement: movementView({ ...movement }) });
  });

  // Limite de sangria do STAFF por lançamento (RN-CX-09/23): só o OWNER muda, e a mudança fica na auditoria.
  app.put("/api/cashier/staff-withdrawal-limit", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply: FastifyReply) => {
    const { storeId, userId } = request.user;
    const parsed = setCashStaffLimitSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Informe o limite em centavos (0 ou mais).", code: "VALIDATION_ERROR" });
    const before = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { cashStaffWithdrawalLimitCents: true } });
    await prisma.store.update({ where: { id: storeId }, data: { cashStaffWithdrawalLimitCents: parsed.data.limitCents } });
    logAudit({
      storeId,
      userId,
      action: "cashier.staff_limit_change",
      targetType: "Store",
      targetId: storeId,
      metadata: { fromCents: before.cashStaffWithdrawalLimitCents, toCents: parsed.data.limitCents },
    });
    return { staffWithdrawalLimitCents: parsed.data.limitCents };
  });

  app.get("/api/cashier/sessions", { preHandler: app.requirePanelAuth }, async (request) => {
    const { storeId, role } = request.user;
    const sessions = await prisma.cashSession.findMany({
      where: { storeId, closedAt: { not: null } },
      orderBy: { openedAt: "desc" },
      take: 50,
    });
    return { sessions: sessions.map((s) => closedSessionView(s, role)) };
  });
};

export default cashierRoutes;
