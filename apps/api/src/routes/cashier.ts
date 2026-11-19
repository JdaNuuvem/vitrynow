import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { Prisma, prisma } from "@meucardapio/db";
import { closeCashSessionSchema, createCashMovementSchema, openCashSessionSchema, setCashStaffLimitSchema } from "@meucardapio/shared-types";
import { toRow as auditRow, type AuditInput } from "../lib/audit";
import { computeCashSummary } from "../lib/cashier";
import { CASH_TOLERANCE_CENTS, closePreview, evaluateClose, validateMovementReason } from "../lib/cashRules";
import { findOwnedOrNotFound } from "../lib/tenant";
import { publishToOwners } from "../realtime/hub";
import { CodedError, useDomainErrors } from "../shared/errors";

const STALE_AFTER_HOURS = 20;
const CASH_RULE_NOTICE = { id: "CASH_RECEIVED_V1", text: "O cálculo do caixa mudou: agora só conta o dinheiro já recebido." } as const;

type Db = Prisma.TransactionClient;
type SessionWithMovements = Prisma.CashSessionGetPayload<{ include: { movements: true } }>;

// Vendas do período do caixa: tudo o que foi pedido (e já confirmado/pago) entre a abertura
// e o fechamento — ou até agora, se o caixa ainda está aberto.
async function summarizeSession(db: Db | typeof prisma, storeId: string, session: SessionWithMovements) {
  const orders = await db.order.findMany({
    where: {
      storeId,
      awaitingPayment: false,
      // criados no turno OU com dinheiro recebido no turno (entrega pedida antes e paga agora, RN-CX-01)
      OR: [
        { createdAt: { gte: session.openedAt, ...(session.closedAt ? { lte: session.closedAt } : {}) } },
        { paidAt: { gte: session.openedAt, ...(session.closedAt ? { lte: session.closedAt } : {}) } },
        // caixa ABERTO: pedido em dinheiro em andamento, de qualquer data, ainda a receber (informativo, RN-CX-03); o caixa fechado usa só o retrato
        ...(session.closedAt ? [] : [{ paymentMethod: "DINHEIRO" as const, paidAt: null, status: { in: ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA"] as ("CONFIRMADO" | "EM_PREPARO" | "PRONTO" | "SAIU_PARA_ENTREGA")[] } }]),
      ],
    },
    select: { type: true, status: true, totalCents: true, deliveryFeeCents: true, tipCents: true, paymentMethod: true, createdAt: true, paidAt: true, awaitingPayment: true },
  });
  // API-24: o recebimento da mesa entra pelo `receivedAt` (a venda da mesa é o recebimento, não o pedido).
  const receipts = await db.receipt.findMany({
    where: { storeId, receivedAt: { gte: session.openedAt, ...(session.closedAt ? { lte: session.closedAt } : {}) } },
    select: { id: true, receivedAt: true, totalCents: true, serviceFeeCents: true, payments: { select: { method: true, amountCents: true, changeForCents: true } } },
  });
  return computeCashSummary(session, orders, session.closedAt ?? new Date(), receipts);
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
// NENHUMA resposta do caixa, para nenhum papel, devolve id de usuário (só papel e hora, CA-CX-22) nem o retrato interno: tira os campos por nome
// em um lugar só, usado por todas as visões da sessão.
// API-27b (CA-CX-29): esperado e diferença são de 64 bits (BigInt no banco). Na resposta saem como número seguro; acima de MAX_SAFE_INTEGER, como TEXTO.
export const safeCents = (v: bigint | null): number | string | null => (v === null ? null : v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString());
const withoutInternals = <T extends { openedByUserId: string; closedByUserId: string | null; summarySnapshot: Prisma.JsonValue | null; expectedClosingCents: bigint | null; differenceCents: bigint | null }>(s: T) => {
  const { openedByUserId: _opened, closedByUserId: _closed, summarySnapshot: _snapshot, expectedClosingCents, differenceCents, ...rest } = s;
  void _opened;
  void _closed;
  void _snapshot;
  return { ...rest, expectedClosingCents: safeCents(expectedClosingCents), differenceCents: safeCents(differenceCents) };
};
const sessionView = (s: SessionWithMovements) => ({ ...withoutInternals(s), movements: s.movements.map(movementView) });

// R2: a auditoria de uma ação do caixa é gravada DENTRO da transação do dado e é ESTRITA: se o registro falhar, a ação inteira é desfeita
// (503 AUDIT_UNAVAILABLE). Nunca existe abertura, fechamento, movimentação ou mudança de limite sem rastro.
async function auditInTx(tx: Db, entry: AuditInput): Promise<void> {
  try {
    await tx.auditLog.create({ data: auditRow(entry) });
  } catch {
    throw new CodedError(503, "AUDIT_UNAVAILABLE", "Não foi possível registrar a ação no histórico. Tente de novo em instantes.");
  }
}

// Caixa FECHADO (histórico e resumo): o OWNER vê tudo (esperado, contado, diferença, motivo); o STAFF recebe SÓ abertura, fechamento, horários e
// papel de quem fechou, SEM mascaramento parcial (RN-CX-22, CA-CX-27): nada de esperado, contado, diferença, motivo, observações nem retrato.
// (O STAFF que acabou de fechar vê o resultado na resposta do PRÓPRIO fechamento, que usa `ownClosedView`.)
const closedSessionView = (s: Prisma.CashSessionGetPayload<object>, role: "OWNER" | "STAFF") => {
  if (role === "OWNER") return withoutInternals(s);
  return { id: s.id, openedAt: s.openedAt, closedAt: s.closedAt, openingBalanceCents: s.openingBalanceCents, closedByRole: s.closedByRole };
};
const ownClosedView = (s: Prisma.CashSessionGetPayload<object>) => withoutInternals(s);

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
    if (!session) return { session: null, ruleChangeNotice: null, ...rules };

    const summary = await summarizeSession(prisma, storeId, session);
    const openForHours = (Date.now() - session.openedAt.getTime()) / (1000 * 60 * 60);
    const stale = openForHours > STALE_AFTER_HOURS;
    // RN-MIG-04b: caixa aberto ANTES da mudança de regra mostra o aviso uma vez por usuário; a frase vem do servidor.
    const dismissed = session.cashRuleVersion < 2 ? await prisma.userNoticeDismissal.findUnique({ where: { userId_noticeId: { userId: request.user.userId, noticeId: CASH_RULE_NOTICE.id } } }) : null;
    const ruleChangeNotice = session.cashRuleVersion < 2 && !dismissed ? CASH_RULE_NOTICE : null;
    return { session: sessionView(session), summary, expectedBalanceCents: summary.expectedCents, openForHours, stale, ruleChangeNotice, ...rules };
  });

  // Dispensar o aviso de mudança de regra (por usuário; idempotente). Só existe o aviso conhecido; qualquer outro id é 404.
  app.post("/api/cashier/notices/:id/dismiss", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id !== CASH_RULE_NOTICE.id) return reply.code(404).send({ error: "aviso não encontrado", code: "NOT_FOUND" });
    await prisma.userNoticeDismissal.createMany({ data: [{ userId: request.user.userId, noticeId: id }], skipDuplicates: true });
    return { ok: true };
  });

  // Prévia do fechamento: a tela mostra "Sobrou/Faltou" e se o motivo é obrigatório SEM duplicar a regra (CA-CX-19).
  app.get("/api/cashier/close-preview", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId } = request.user;
    const raw = (request.query as { countedCents?: string }).countedCents;
    const counted = raw === undefined || raw === "" ? NaN : Number(raw);
    if (!Number.isInteger(counted) || counted < 0 || counted > 100_000_000) return reply.code(400).send({ error: "Informe o valor contado.", code: "CASH_COUNTED_REQUIRED" });
    const session = await prisma.cashSession.findFirst({ where: { storeId, closedAt: null }, include: { movements: true } });
    if (!session) return reply.code(404).send({ error: "não há caixa aberto", code: "CASH_REQUIRED" });
    const summary = await summarizeSession(prisma, storeId, session);
    return { ...closePreview(summary.expectedCents, counted), sessionId: session.id };
  });

  app.get("/api/cashier/sessions/:id/summary", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, role } = request.user;
    const { id } = request.params as { id: string };
    const session = await findOwnedOrNotFound(
      reply,
      () => prisma.cashSession.findFirst({ where: { id, storeId }, include: { movements: { orderBy: { createdAt: "desc" } } } }),
      "caixa não encontrado",
    );
    if (!session) return reply; // `findOwnedOrNotFound` já enviou o 404
    // Caixa FECHADO: o OWNER recebe o retrato CONGELADO no fechamento (não recalcula; pedidos cancelados depois não mudam o histórico,
    // RN-CX-15); o STAFF recebe só abertura, fechamento, horários e papel, sem resumo nem movimentações (CA-CX-27).
    if (session.closedAt && role !== "OWNER") return { session: closedSessionView(session, role), summary: null };
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
      const session = await prisma.$transaction(async (tx) => {
        const created = await tx.cashSession.create({
          data: {
            storeId,
            openedByUserId: userId,
            openingBalanceCents: parsed.data.openingBalanceCents,
            openingNotes: parsed.data.notes || null,
          },
        });
        await auditInTx(tx, { storeId, userId, action: "cashier.open", targetType: "CashSession", targetId: created.id, metadata: { openingBalanceCents: created.openingBalanceCents, role } });
        return created;
      });
      return reply.code(201).send({ session: withoutInternals(session) });
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

    // Fechamento ATÔMICO e ÚNICO e DETERMINÍSTICO: a decisão sai de UMA leitura travada (`FOR UPDATE`) da sessão MAIS RECENTE da loja, dentro da
    // transação, nunca de uma leitura solta antes dela. Aberta ⇒ fecha; já fechada ⇒ 409 CASH_ALREADY_CLOSED (quem perdeu a corrida e quem clicou
    // de novo recebem a MESMA resposta, qualquer que seja a ordem em que as requisições chegaram); a loja nunca ter tido caixa ⇒ 404 CASH_REQUIRED.
    // O retrato do resumo é calculado e gravado DENTRO da mesma transação (nenhuma movimentação entra no meio).
    const result = await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; closedAt: Date | null }[]>`SELECT "id", "closedAt" FROM "CashSession" WHERE "storeId" = ${storeId} ORDER BY "openedAt" DESC, "id" DESC LIMIT 1 FOR UPDATE`;
        if (!rows[0]) throw new CodedError(404, "CASH_REQUIRED", "não há caixa aberto");
        if (parsed.data.sessionId !== undefined && rows[0].id !== parsed.data.sessionId) {
          throw new CodedError(409, "CASH_SESSION_CHANGED", "O caixa em atividade mudou. Confira o novo caixa antes de fechar.");
        }
        if (rows[0].closedAt) throw new CodedError(409, "CASH_ALREADY_CLOSED", "Este caixa já foi fechado.");
        const session = await tx.cashSession.findUniqueOrThrow({ where: { id: rows[0].id }, include: { movements: true } });
        const closedAt = new Date();
        const summary = await summarizeSession(tx, storeId, { ...session, closedAt });
        if (parsed.data.expectedBalanceCents !== undefined && summary.expectedCents !== parsed.data.expectedBalanceCents) {
          throw new CodedError(409, "CASH_PREVIEW_CHANGED", "O saldo mudou. Confira os valores novamente antes de fechar.");
        }
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
        // Auditoria: esperado, contado, diferença e o CÓDIGO do motivo; nunca o texto livre (ADR-0014). Dentro da transação (R2).
        await auditInTx(tx, {
          storeId,
          userId,
          action: "cashier.close",
          targetType: "CashSession",
          targetId: updated.id,
          metadata: { closingBalanceCents: counted, expectedCents: summary.expectedCents, differenceCents, reason: verdict.reason, role },
        });
        return { updated, summary, verdict, differenceCents };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    // CA-CX-28: o STAFF fechou com diferença ACIMA da tolerância (exato R$ 5,00 não conta) ⇒ o painel do dono é avisado SÓ com o id do caixa
    // (regra do canal da loja: sem valor, papel nem texto; o dono busca o detalhe na tela do caixa fechado, que é só dele) e SÓ às
    // conexões de OWNER: STAFF e impressoras nem recebem o sinal.
    if (role === "STAFF" && Math.abs(result.differenceCents) > CASH_TOLERANCE_CENTS) {
      publishToOwners(storeId, { type: "cashier.difference_over_tolerance", sessionId: result.updated.id });
    }
    // Quem acabou de fechar recebe o RESULTADO na resposta do próprio fechamento (Sobrou/Faltou/Fechou certo), mesmo sendo STAFF.
    return { session: ownClosedView(result.updated), summary: result.summary, differenceCents: result.differenceCents, toleranceCents: CASH_TOLERANCE_CENTS };
  });

  app.post("/api/cashier/movements", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId, role } = request.user;
    const parsed = createCashMovementSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const { type, amountCents } = parsed.data;
    // Motivo ANTES de tocar no banco: sem motivo (ou de outro tipo) nada é criado (CA-CX-20/21).
    const { reason, reasonText } = validateMovementReason(type, parsed.data.reason, parsed.data.reasonText);

    // M3 (API-27b): `Idempotency-Key` opcional contra duplo clique e reenvio de rede. Mesma chave + mesmo conteúdo => a MESMA movimentação (200, sem
    // novo lançamento nem nova auditoria); mesma chave com conteúdo diferente => 409 IDEMPOTENCY_KEY_REUSED.
    const rawKey = request.headers["idempotency-key"];
    const idempotencyKey = typeof rawKey === "string" && rawKey.length > 0 ? rawKey : null;
    if (rawKey !== undefined && (idempotencyKey === null || !/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey))) {
      return reply.code(400).send({ error: "Idempotency-Key inválida.", code: "VALIDATION_ERROR" });
    }

    const open = await prisma.cashSession.findFirst({ where: { storeId, closedAt: null }, select: { id: true } });
    if (!open) return reply.code(409).send({ error: "não há caixa aberto", code: "CASH_REQUIRED" });
    let replayed = false;

    const movement = await prisma.$transaction(
      async (tx) => {
        // Trava o caixa: duas sangrias simultâneas se enfileiram e a segunda enxerga o saldo já reduzido (RN-CX-10).
        const rows = await tx.$queryRaw<{ closedAt: Date | null }[]>`SELECT "closedAt" FROM "CashSession" WHERE "id" = ${open.id} AND "storeId" = ${storeId} FOR UPDATE`;
        if (!rows[0] || rows[0].closedAt) throw new CodedError(409, "CASH_REQUIRED", "não há caixa aberto");
        if (idempotencyKey) {
          const previous = await tx.cashMovement.findUnique({ where: { cashSessionId_idempotencyKey: { cashSessionId: open.id, idempotencyKey } } });
          if (previous) {
            if (previous.type !== type || previous.amountCents !== amountCents || previous.reason !== reason || previous.reasonText !== reasonText) {
              throw new CodedError(409, "IDEMPOTENCY_KEY_REUSED", "Esta chave já foi usada em outra movimentação.");
            }
            replayed = true;
            return previous;
          }
        }
        if (type === "SANGRIA") {
          if (role !== "OWNER") {
            // Limite ÚNICO do dono, aplicado à SOMA das sangrias do STAFF neste caixa (turno) incluindo a que chega, dentro da trava da linha do
            // caixa: um lançamento maior que o limite já é recusado; a sangria do OWNER não conta; um caixa novo recomeça a soma (RN-CX-09).
            const store = await tx.store.findUniqueOrThrow({ where: { id: storeId }, select: { cashStaffWithdrawalLimitCents: true } });
            const used = await tx.cashMovement.aggregate({ where: { cashSessionId: open.id, type: "SANGRIA", createdByRole: "STAFF" }, _sum: { amountCents: true } });
            if ((used._sum.amountCents ?? 0) + amountCents > store.cashStaffWithdrawalLimitCents) {
              throw new CodedError(403, "CASH_WITHDRAWAL_NEEDS_OWNER", "Peça ao dono para autorizar essa sangria.");
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
        const created = await tx.cashMovement.create({
          data: { cashSessionId: open.id, type, amountCents, notes: parsed.data.notes ?? null, reason, reasonText, createdByUserId: userId, createdByRole: role, idempotencyKey },
        });
        // Auditoria: tipo, valor e o CÓDIGO do motivo; o texto livre do `OUTRO` NÃO vai para o log. Dentro da transação (R2).
        await auditInTx(tx, { storeId, userId, action: "cashier.movement", targetType: "CashMovement", targetId: created.id, metadata: { type, amountCents, reason, role } });
        return created;
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    if (replayed) reply.header("Idempotent-Replay", "true");
    return reply.code(replayed ? 200 : 201).send({ movement: movementView({ ...movement }) });
  });

  // Limite de sangria do STAFF por lançamento (RN-CX-09/23): só o OWNER muda, e a mudança fica na auditoria.
  app.put("/api/cashier/staff-withdrawal-limit", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply: FastifyReply) => {
    const { storeId, userId } = request.user;
    const parsed = setCashStaffLimitSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Informe o limite em centavos (0 ou mais).", code: "VALIDATION_ERROR" });
    await prisma.$transaction(async (tx) => {
      const before = await tx.store.findUniqueOrThrow({ where: { id: storeId }, select: { cashStaffWithdrawalLimitCents: true } });
      await tx.store.update({ where: { id: storeId }, data: { cashStaffWithdrawalLimitCents: parsed.data.limitCents } });
      await auditInTx(tx, {
        storeId,
        userId,
        action: "cashier.staff_limit_change",
        targetType: "Store",
        targetId: storeId,
        metadata: { fromCents: before.cashStaffWithdrawalLimitCents, toCents: parsed.data.limitCents },
      });
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
