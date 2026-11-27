import { clientIpOf } from "../lib/clientIp";
import { minOrderMessage, QUEUED_ORDER_STATUSES } from "@meucardapio/shared-types";
import { buildOrderLines } from "../lib/orderItems";
import { quoteOrder } from "../lib/quoteOrder";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, prisma } from "@meucardapio/db";
import { createTableOrderSchema, createTableSchema, panelRoleSchema, qrSettingsSchema, receiveTableSchema, floorLayoutSchema, RESERVATION_SOON_AFTER_MIN, RESERVATION_SOON_BEFORE_MIN, tableAlertClearSchema, tableGuestsSchema, tableStatusOf, tableWaiterSchema, updateTableSchema, memberName } from "@meucardapio/shared-types";
import { getRequestEntitlements, requireFeature } from "../lib/subscription";
import { logAudit } from "../lib/audit";
import { buildMenuView } from "../lib/menuView";
import { clientKey } from "../lib/clientKey";
import { ORDER_TX_OPTIONS } from "../lib/order-code";
import { newOrderToken } from "../lib/orderToken";
import { toOrderPaymentMethod } from "../lib/paymentMethod";
import { SALE_STATUSES } from "../lib/saleLines";
import { limited, tooMany } from "../lib/slidingLimit";
import { isSoldOutNow } from "../lib/soldOut";
import { hashToken } from "../lib/tokenHash";
import { orderService } from "../modules/orders/orders.module";
import { publishToStore } from "../realtime/hub";
import { CodedError, useDomainErrors } from "../shared/errors";

// API-22 — mesa e QR (ADR-0002 nível 1; spec do Leonardo B, RN-MB-01..13).
// Segurança (ADR-0002 §7): o QR é estático e NÃO abre a conta da mesa. O primeiro pedido emite um token anônimo do APARELHO (256 bits; só o hash vai ao banco)
// e o cliente só vê os pedidos feitos com aquele token. Token inexistente, mesa inativa e slug divergente respondem o MESMO 404 (D2-3).

export const DEVICE_TOKEN_HEADER = "x-device-token";
const MAX_TOKEN_LENGTH = 200;
const DEVICE_TOKEN_FORMAT = /^mcd_[A-Za-z0-9_-]{43}$/; // R1: token fora do formato nunca é aceito (fixação de token); emite-se um novo
const QR_OPEN_CAP = 10; // Atlas/Nightingale C2: teto de pedidos ABERTOS (PENDENTE, CONFIRMADO, EM_PREPARO) por mesa: o QR imprime ao chegar e cada pedido gasta papel. Editável pela plataforma
const QR_BURST_PENDING = 5; // RN-MB-08: tantos pedidos PENDENTE na mesa => alerta no painel (não bloqueia o cliente)
const newDeviceToken = () => {
  const token = "mcd_" + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
};
const newQrToken = () => "mcq_" + randomBytes(32).toString("base64url"); // >=128 bits, opaco, nunca derivado de id/slug

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "Mesa não encontrada.", code: "TABLE_NOT_FOUND" });

function publicHeaders(reply: FastifyReply) {
  reply.header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex, nofollow").header("Cache-Control", "no-store");
}

/** Mesa ativa da loja `slug` com o `qrToken`; null em qualquer divergência (resposta única). */
async function resolveTable(slug: string, qrToken: string) {
  if (!qrToken || qrToken.length > MAX_TOKEN_LENGTH) return null;
  const table = await prisma.table.findUnique({ where: { qrToken }, include: { store: true } });
  if (!table || !table.active || table.store.slug !== slug) return null;
  return { table, store: table.store };
}

function deviceTokenOf(request: FastifyRequest): string | null {
  const raw = request.headers[DEVICE_TOKEN_HEADER];
  return typeof raw === "string" && raw.length <= MAX_TOKEN_LENGTH && DEVICE_TOKEN_FORMAT.test(raw) ? raw : null;
}

const RECEIVES_PER_MINUTE = 60;
// Conta da mesa (RN-MB-02, virtual): pedidos ACEITOS (CONFIRMADO em diante), não cancelados, ainda não recebidos.
const accountWhere = (storeId: string, tableId: string) => ({ storeId, tableId, receiptId: null, paidAt: null, awaitingPayment: false, status: { in: [...SALE_STATUSES] } });

type TableRow = { id: string; label: string; qrToken: string; active: boolean; position: number; posX: number; posZ: number; rotation: number; shape: string; seats: number; area: string | null; callWaiterAt: Date | null; askBillAt: Date | null; guests?: number | null; waiterUserId?: string | null; waiter?: { id: string; email: string; displayName: string | null } | null };
const tableView = (t: TableRow, slug: string) => ({
  id: t.id,
  label: t.label,
  active: t.active,
  position: t.position,
  qrToken: t.qrToken,
  qrPath: `/loja/${slug}/m/${t.qrToken}`,
  // SALÃO 3D: planta e avisos guardados
  layout: { posX: t.posX, posZ: t.posZ, rotation: t.rotation, shape: t.shape, seats: t.seats, area: t.area },
  callWaiterAt: t.callWaiterAt?.toISOString() ?? null,
  askBillAt: t.askBillAt?.toISOString() ?? null,
  guests: t.guests ?? null,
  waiter: t.waiter ? { id: t.waiter.id, name: memberName(t.waiter) } : null, // nome de exibição ou a parte do e-mail antes do @
});

const tableRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  useDomainErrors(app);

  // ---------- Painel ----------
  app.get("/api/tables", { preHandler: app.requirePanelAuth }, async (request) => {
    const { storeId } = request.user;
    const [store, tables, pending, account] = await Promise.all([
      prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { slug: true, qrOrderingEnabled: true, qrOrdersNeedApproval: true, serviceFeePercent: true } }),
      prisma.table.findMany({ where: { storeId }, orderBy: [{ position: "asc" }, { label: "asc" }], include: { waiter: { select: { id: true, email: true, displayName: true } } } }),
      prisma.order.groupBy({ by: ["tableId"], where: { storeId, tableId: { not: null }, receiptId: null, status: "PENDENTE" }, _count: { _all: true } }),
      prisma.order.groupBy({ by: ["tableId"], where: { storeId, tableId: { not: null }, receiptId: null, paidAt: null, awaitingPayment: false, status: { in: [...SALE_STATUSES] } }, _count: { _all: true }, _sum: { totalCents: true }, _min: { createdAt: true } }),
    ]);
    // próxima reserva de cada mesa (de 15 min atrás até as próximas 24 h)
    const now = Date.now();
    const upcoming = await prisma.reservation.findMany({
      where: { storeId, status: "BOOKED", tableId: { not: null }, startsAt: { gte: new Date(now - RESERVATION_SOON_AFTER_MIN * 60_000), lte: new Date(now + 24 * 3600_000) } },
      orderBy: { startsAt: "asc" },
      select: { id: true, tableId: true, customerName: true, partySize: true, startsAt: true },
    });
    const nextBy = new Map<string, (typeof upcoming)[number]>();
    for (const r of upcoming) if (r.tableId && !nextBy.has(r.tableId)) nextBy.set(r.tableId, r);
    const pendingBy = new Map(pending.map((p) => [p.tableId, p._count._all]));
    const accountBy = new Map(account.map((a) => [a.tableId, { count: a._count._all, totalCents: a._sum.totalCents ?? 0, openedAt: a._min.createdAt }]));
    return {
      settings: { qrOrderingEnabled: store.qrOrderingEnabled, qrOrdersNeedApproval: store.qrOrdersNeedApproval, serviceFeePercent: store.serviceFeePercent },
      tables: tables.map((t) => {
        const acc = accountBy.get(t.id);
        const pendingOrders = pendingBy.get(t.id) ?? 0;
        // RN-MB-02: livre = sem pedido aceito a receber e sem pedido PENDENTE.
        const accountOrders = acc?.count ?? 0;
        // SALÃO 3D: status calculado AQUI (fonte única, shared-types) e "aberta desde" = 1º pedido da conta
        const next = nextBy.get(t.id);
        const reservedSoon = !!next && next.startsAt.getTime() - now <= RESERVATION_SOON_BEFORE_MIN * 60_000;
        const status = tableStatusOf({ active: t.active, pendingOrders, accountOrders, callWaiterAt: t.callWaiterAt, askBillAt: t.askBillAt, reservedSoon, guests: t.guests });
        return { ...tableView(t, store.slug), pendingOrders, accountOrders, accountCents: acc?.totalCents ?? 0, free: pendingOrders === 0 && !acc, status, openedAt: acc?.openedAt?.toISOString() ?? null, nextReservation: next ? { id: next.id, customerName: next.customerName, partySize: next.partySize, startsAt: next.startsAt.toISOString() } : null };
      }),
    };
  });

  app.post("/api/tables", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = createTableSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { slug: true } });
    try {
      // SALÃO 3D: mesa nova entra na próxima vaga da grade (6 por fileira, 2,5 m); o dono arruma no modo edição.
      const n = await prisma.table.count({ where: { storeId } });
      const table = await prisma.table.create({ data: { storeId, label: parsed.data.label, position: parsed.data.position ?? 0, qrToken: newQrToken(), posX: (n % 6) * 2.5, posZ: Math.floor(n / 6) * 2.5 } });
      logAudit({ storeId, userId, action: "table.create", targetType: "Table", targetId: table.id, metadata: { label: table.label } });
      return reply.code(201).send({ table: tableView(table, store.slug) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CodedError(409, "TABLE_LABEL_TAKEN", "Já existe uma mesa com esse nome.");
      throw error;
    }
  });

  app.patch("/api/tables/:id", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = updateTableSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { slug: true } });
    try {
      // storeId no where: mesa de outra loja não existe para esta (404, nunca 403).
      const result = await prisma.table.updateMany({ where: { id, storeId }, data: parsed.data });
      if (result.count === 0) return notFound(reply);
      const table = await prisma.table.findFirstOrThrow({ where: { id, storeId } });
      logAudit({ storeId, userId, action: "table.update", targetType: "Table", targetId: id, metadata: parsed.data });
      publishToStore(storeId, { type: "table.updated", tableId: id });
      return { table: tableView(table, store.slug) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CodedError(409, "TABLE_LABEL_TAKEN", "Já existe uma mesa com esse nome.");
      throw error;
    }
  });

  // "Trocar QR" (RN-MB-12): um clique, auditado; o QR impresso antigo passa a responder o 404 padrão.
  app.post("/api/tables/:id/regenerate-qr", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const result = await prisma.table.updateMany({ where: { id, storeId }, data: { qrToken: newQrToken() } });
    if (result.count === 0) return notFound(reply);
    const [table, store] = await Promise.all([prisma.table.findFirstOrThrow({ where: { id, storeId } }), prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { slug: true } })]);
    logAudit({ storeId, userId, action: "table.regenerate_qr", targetType: "Table", targetId: id });
    return { table: tableView(table, store.slug) };
  });

  app.delete("/api/tables/:id", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const table = await prisma.table.findFirst({ where: { id, storeId }, select: { id: true, label: true } });
    if (!table) return notFound(reply);
    try {
      await prisma.table.delete({ where: { id } });
    } catch (error) {
      // FK de Order: mesa com pedido não se apaga (histórico/caixa); desative.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new CodedError(409, "TABLE_HAS_ORDERS", "A mesa tem pedidos. Desative-a em vez de apagar.");
      throw error;
    }
    logAudit({ storeId, userId, action: "table.delete", targetType: "Table", targetId: id, metadata: { label: table.label } });
    return reply.code(204).send();
  });

  // Configuração do QR (RN-MB-01/15). Desligar o aceite exige confirmar o aviso.
  app.post("/api/store/qr-settings", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = qrSettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const { qrOrderingEnabled, qrOrdersNeedApproval, confirmNoApproval, serviceFeePercent } = parsed.data;
    if (qrOrdersNeedApproval === false && !confirmNoApproval) {
      throw new CodedError(400, "CONFIRMATION_REQUIRED", "Sem o aceite, qualquer pessoa com o QR poderá lançar pedidos já aceitos, que entram direto no andamento da cozinha. Confirme para desligar o aceite.");
    }
    const store = await prisma.store.update({
      where: { id: storeId },
      data: { qrOrderingEnabled, qrOrdersNeedApproval, serviceFeePercent },
      select: { qrOrderingEnabled: true, qrOrdersNeedApproval: true, serviceFeePercent: true },
    });
    logAudit({ storeId, userId, action: "store.qr_settings", targetType: "Store", targetId: storeId, metadata: { qrOrderingEnabled, qrOrdersNeedApproval, serviceFeePercent } });
    return { settings: store };
  });

  // Conta da mesa para a EQUIPE (RN-MB-02): a lista e o total só existem aqui, nunca no QR do cliente (RN-MB-06).
  app.get("/api/tables/:id/account", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId } = request.user;
    const { id } = request.params as { id: string };
    const table = await prisma.table.findFirst({ where: { id, storeId }, select: { id: true, label: true } });
    if (!table) return notFound(reply);
    const [orders, pendingOrders] = await Promise.all([
      prisma.order.findMany({
        where: accountWhere(storeId, id),
        orderBy: { createdAt: "asc" },
        select: { id: true, code: true, status: true, totalCents: true, createdAt: true, customerName: true, items: { select: { productName: true, quantity: true, unitPriceCents: true } } },
      }),
      prisma.order.count({ where: { storeId, tableId: id, receiptId: null, status: "PENDENTE" } }),
    ]);
    return { table, orders, pendingOrders, totalCents: orders.reduce((sum, o) => sum + o.totalCents, 0) };
  });

  // RECEBER A MESA (API-24/42/43; RN-MB-03/04/05, ADR-0012): soma a conta no SERVIDOR e grava UM Receipt, marcando os pedidos.
  // Todos os planos: taxa de serviço opcional (percentual da loja) e desconto em R$. PRO (`tab_service`): pagamento dividido em várias formas.
  app.post("/api/tables/:id/receive", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId, role } = request.user;
    const { id } = request.params as { id: string };
    if (limited(`table-receive:${userId}`, RECEIVES_PER_MINUTE)) return tooMany(reply);
    const parsed = receiveTableSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const input = parsed.data;
    // Partes do pagamento: uma (paymentMethod) ou várias (payments, só PRO). Valores das partes conferidos contra o total dentro da transação.
    const parts: { method: NonNullable<ReturnType<typeof toOrderPaymentMethod>>; amountCents?: number; changeForCents?: number }[] = [];
    for (const part of input.payments ?? [{ method: input.paymentMethod!, changeForCents: input.changeForCents }]) {
      const method = toOrderPaymentMethod(part.method);
      if (!method) return reply.code(400).send({ error: "Forma de pagamento inválida.", code: "PAYMENT_METHOD_REQUIRED" });
      if (part.changeForCents !== undefined && method !== "DINHEIRO") return reply.code(400).send({ error: "Troco só vale para pagamento em dinheiro.", code: "CHANGE_ONLY_CASH" });
      parts.push({ method, amountCents: "amountCents" in part ? part.amountCents : undefined, changeForCents: part.changeForCents });
    }
    if (input.payments) {
      const entitlements = await getRequestEntitlements(request, storeId);
      if (!entitlements.features.includes("tab_service")) {
        return reply.code(402).send({ error: "Dividir a conta não está disponível no seu plano.", code: "FEATURE_LOCKED", feature: "tab_service", details: { feature: "tab_service" } });
      }
    }
    const method = parts[0].method; // forma principal (compatível com a resposta antiga)
    const [table, store] = await Promise.all([
      prisma.table.findFirst({ where: { id, storeId }, select: { id: true } }),
      prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { serviceFeePercent: true, manualDiscountStaffLimitPercent: true } }),
    ]);
    if (!table) return notFound(reply);
    if (input.includeServiceFee && store.serviceFeePercent === 0) return reply.code(400).send({ error: "Esta loja não cobra taxa de serviço.", code: "SERVICE_FEE_DISABLED" });

    const receipt = await prisma.$transaction(async (tx) => {
      // Trava os pedidos da mesa: cancelar e receber ao mesmo tempo se enfileiram (o cancelamento só vale com receiptId nulo).
      // ORDER BY "id": duas transações que travam VÁRIAS linhas têm de travá-las na MESMA ordem, senão o plano da consulta (que muda sob carga) as cruza e dá deadlock (500).
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "storeId" = ${storeId} AND "tableId" = ${id} AND "receiptId" IS NULL ORDER BY "id" FOR UPDATE`;
      // CA-MB-13: pedido PENDENTE bloqueia; aceitar ou recusar antes.
      const pending = await tx.order.count({ where: { storeId, tableId: id, receiptId: null, status: "PENDENTE" } });
      if (pending > 0) throw new CodedError(409, "PENDING_ORDERS", "Aceite ou recuse os pedidos pendentes da mesa antes de receber.", { details: { pendingOrders: pending } });
      const orders = await tx.order.findMany({ where: accountWhere(storeId, id), select: { id: true, totalCents: true } });
      const subtotalCents = orders.reduce((sum, o) => sum + o.totalCents, 0);
      if (orders.length === 0 || subtotalCents <= 0) throw new CodedError(409, "NOTHING_TO_RECEIVE", "Esta mesa não tem conta a receber.");
      if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== subtotalCents) {
        throw new CodedError(409, "TOTAL_CHANGED", "A conta da mesa mudou. Confira o novo total.", { details: { totalCents: subtotalCents } });
      }
      const serviceFeeCents = input.includeServiceFee ? Math.round((subtotalCents * store.serviceFeePercent) / 100) : 0;
      const discountCents = input.discountCents ?? 0;
      const totalCents = subtotalCents + serviceFeeCents - discountCents;
      if (totalCents <= 0) throw new CodedError(400, "DISCOUNT_TOO_HIGH", "O desconto não pode zerar a conta. Para cortesia total, cancele os pedidos.");
      // Mesmo limite do pedido manual (RN-B2-06): STAFF até o percentual da loja sobre a conta com taxa; acima, só o dono.
      if (discountCents > 0 && role !== panelRoleSchema.enum.OWNER && discountCents * 100 > (subtotalCents + serviceFeeCents) * store.manualDiscountStaffLimitPercent) {
        throw new CodedError(403, "DISCOUNT_ABOVE_LIMIT", "Desconto acima do seu limite. Peça ao dono.", { details: { limitPercent: store.manualDiscountStaffLimitPercent } });
      }
      // Uma forma: ela leva o total. Várias: a soma das partes tem de bater com o total, centavo a centavo.
      if (parts.length === 1) parts[0].amountCents = totalCents;
      const paid = parts.reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
      if (paid !== totalCents) throw new CodedError(400, "PAYMENTS_MISMATCH", "A soma das formas de pagamento não bate com o total da conta.", { details: { totalCents, paidCents: paid } });
      for (const p of parts) {
        if (p.changeForCents !== undefined && p.changeForCents < p.amountCents!) throw new CodedError(400, "CHANGE_TOO_LOW", "O valor para troco precisa cobrir a parte paga em dinheiro.");
      }
      // RN-MB-03/CA-MB-04: dinheiro só com caixa ABERTO. FOR SHARE: o fechamento (FOR UPDATE) espera este recebimento terminar.
      let cashSessionId: string | null = null;
      if (parts.some((p) => p.method === "DINHEIRO")) {
        const open = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CashSession" WHERE "storeId" = ${storeId} AND "closedAt" IS NULL FOR SHARE`;
        if (open.length === 0) throw new CodedError(409, "CASH_REQUIRED", "Abra o caixa para receber esta mesa em dinheiro.");
        cashSessionId = open[0].id;
      }
      const receivedAt = new Date();
      const created = await tx.receipt.create({
        data: {
          storeId,
          kind: "TABLE",
          tableId: id,
          subtotalCents,
          serviceFeeCents,
          discountCents,
          totalCents,
          receivedAt,
          receivedByUserId: userId,
          cashSessionId,
          payments: { create: parts.map((p) => ({ method: p.method, amountCents: p.amountCents!, changeForCents: p.changeForCents ?? null })) },
        },
        include: { payments: true },
      });
      const marked = await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) }, storeId, receiptId: null }, data: { receiptId: created.id, paidAt: receivedAt } });
      if (marked.count !== orders.length) throw new CodedError(409, "ORDER_STATE_CHANGED", "A conta da mesa mudou enquanto você agia. Atualize a tela.");
      await tx.table.updateMany({ where: { id, storeId }, data: { callWaiterAt: null, askBillAt: null, guests: null } }); // mesa recebida: avisos e pessoas encerrados
      return { ...created, orderIds: orders.map((o) => o.id) };
    }, ORDER_TX_OPTIONS);

    logAudit({
      storeId, userId, action: "table.receive", targetType: "Receipt", targetId: receipt.id,
      metadata: { tableId: id, method, methods: parts.map((p) => p.method), subtotalCents: receipt.subtotalCents, serviceFeeCents: receipt.serviceFeeCents, discountCents: receipt.discountCents, totalCents: receipt.totalCents, orders: receipt.orderIds.length },
    });
    for (const orderId of receipt.orderIds) publishToStore(storeId, { type: "order.updated", orderId });
    publishToStore(storeId, { type: "table.updated", tableId: id });
    const single = parts.length === 1 ? parts[0] : null;
    return reply.code(201).send({
      receipt: {
        id: receipt.id,
        subtotalCents: receipt.subtotalCents,
        serviceFeeCents: receipt.serviceFeeCents,
        discountCents: receipt.discountCents,
        totalCents: receipt.totalCents,
        receivedAt: receipt.receivedAt,
        method,
        changeForCents: single?.changeForCents ?? null,
        changeDueCents: single?.changeForCents !== undefined ? single.changeForCents - receipt.totalCents : null,
        payments: receipt.payments.map((p) => ({ method: p.method, amountCents: p.amountCents, changeForCents: p.changeForCents, changeDueCents: p.changeForCents !== null ? p.changeForCents - p.amountCents : null })),
        orderIds: receipt.orderIds,
      },
    });
  });

  // ---------- SALÃO 3D ----------
  // Aviso do QR atendido (qualquer pessoa da equipe): some do mapa e da lista.
  app.post("/api/tables/:id/alerts/clear", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = tableAlertClearSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const { kind } = parsed.data;
    const data = kind === "ALL" ? { callWaiterAt: null, askBillAt: null } : kind === "ASK_BILL" ? { askBillAt: null } : { callWaiterAt: null };
    const result = await prisma.table.updateMany({ where: { id, storeId }, data });
    if (result.count === 0) return notFound(reply);
    logAudit({ storeId, userId, action: "table.alert_clear", targetType: "Table", targetId: id, metadata: { kind } });
    publishToStore(storeId, { type: "table.updated", tableId: id });
    return { ok: true };
  });

  // Garçom responsável: o dono escolhe qualquer pessoa da equipe; o garçom só assume a mesa para si (ou larga a que é dele).
  app.post("/api/tables/:id/waiter", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId, role } = request.user;
    const { id } = request.params as { id: string };
    const parsed = tableWaiterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const target = parsed.data.userId;
    const table = await prisma.table.findFirst({ where: { id, storeId }, select: { waiterUserId: true } });
    if (!table) return notFound(reply);
    if (role !== panelRoleSchema.enum.OWNER) {
      const allowed = target === userId || (target === null && table.waiterUserId === userId);
      if (!allowed) throw new CodedError(403, "FORBIDDEN_ROLE", "Você só pode assumir a mesa para você. Peça ao dono para trocar o garçom.");
    }
    if (target && !(await prisma.user.findFirst({ where: { id: target, storeId }, select: { id: true } }))) {
      throw new CodedError(404, "USER_NOT_FOUND", "Pessoa da equipe não encontrada.");
    }
    await prisma.table.updateMany({ where: { id, storeId }, data: { waiterUserId: target } });
    logAudit({ storeId, userId, action: "table.waiter", targetType: "Table", targetId: id, metadata: { waiterUserId: target } });
    publishToStore(storeId, { type: "table.updated", tableId: id });
    return { ok: true };
  });

  // Pessoas sentadas agora (qualquer pessoa da equipe). Zera ao receber a mesa.
  app.post("/api/tables/:id/guests", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = tableGuestsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const result = await prisma.table.updateMany({ where: { id, storeId }, data: { guests: parsed.data.guests } });
    if (result.count === 0) return notFound(reply);
    logAudit({ storeId, userId, action: "table.guests", targetType: "Table", targetId: id, metadata: { guests: parsed.data.guests } });
    publishToStore(storeId, { type: "table.updated", tableId: id });
    return { ok: true };
  });

  // Planta: elementos fixos do salão (as mesas e seus status vêm de GET /api/tables).
  app.get("/api/floor", { preHandler: [app.requirePanelAuth, requireFeature("floor_3d")] }, async (request) => {
    const elements = await prisma.floorElement.findMany({ where: { storeId: request.user.storeId }, orderBy: { id: "asc" } });
    return { elements: elements.map(({ storeId: _s, ...e }) => e) };
  });

  // Salvar a planta (modo edição, só o dono): posição/formato/lugares/setor das mesas e a lista COMPLETA de elementos, numa transação.
  app.put("/api/floor", { preHandler: [app.requirePanelAuth, app.requireOwner, requireFeature("floor_3d")] }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = floorLayoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const { tables, elements } = parsed.data;
    const owned = await prisma.table.count({ where: { storeId, id: { in: tables.map((t) => t.id) } } });
    if (owned !== tables.length) return notFound(reply);
    await prisma.$transaction(async (tx) => {
      for (const { id, ...layout } of tables) await tx.table.updateMany({ where: { id, storeId }, data: layout });
      await tx.floorElement.deleteMany({ where: { storeId } });
      if (elements.length) await tx.floorElement.createMany({ data: elements.map((e) => ({ ...e, storeId })) });
    });
    logAudit({ storeId, userId, action: "floor.save", targetType: "Store", targetId: storeId, metadata: { tables: tables.length, elements: elements.length } });
    publishToStore(storeId, { type: "table.updated", tableId: "*" });
    return { ok: true };
  });

  // ---------- Público (QR) ----------
  const PUBLIC_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  app.get("/stores/:slug/tables/:qrToken/menu", PUBLIC_LIMIT, async (request, reply) => {
    publicHeaders(reply);
    const { slug, qrToken } = request.params as { slug: string; qrToken: string };
    const found = await resolveTable(slug, qrToken);
    if (!found) return notFound(reply);
    const menu = await buildMenuView(found.store);
    return { ...menu, table: { label: found.table.label }, qr: { orderingEnabled: found.store.qrOrderingEnabled, needsApproval: found.store.qrOrdersNeedApproval } };
  });

  app.post("/stores/:slug/tables/:qrToken/orders", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    publicHeaders(reply);
    const { slug, qrToken } = request.params as { slug: string; qrToken: string };
    const found = await resolveTable(slug, qrToken);
    if (!found) return notFound(reply);
    const { table, store } = found;
    // D2-2: limite duplo — rígido por (mesa, IP), generoso por mesa (não derruba a mesa inteira por um abusador).
    if (limited(`qr-order:${table.id}:${clientKey(clientIpOf(request))}`, 6) || limited(`qr-order-table:${table.id}`, 12)) return tooMany(reply);

    if (!store.qrOrderingEnabled) return reply.code(409).send({ error: "Esta loja não recebe pedidos pelo QR. Chame o atendente.", code: "QR_ORDERING_DISABLED" });
    if (!store.acceptingOrders) return reply.code(409).send({ error: "A loja não está aceitando pedidos no momento.", code: "STORE_CLOSED" });

    const parsed = createTableOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const input = parsed.data;

    const products = await prisma.product.findMany({ where: { storeId: store.id, id: { in: input.items.map((i) => i.productId) } }, include: { additionals: true } });
    if (products.length !== new Set(input.items.map((i) => i.productId)).size) {
      return reply.code(400).send({ error: "Um ou mais produtos não estão mais no cardápio. Atualize a página.", code: "PRODUCT_NOT_FOUND" });
    }
    const now = new Date();
    const unavailable = products.filter((p) => !p.active || isSoldOutNow(p, now));
    if (unavailable.length > 0) {
      return reply.code(400).send({
        error: `Item indisponível no momento: ${unavailable.map((p) => p.name).join(", ")}.`,
        code: "ITEM_UNAVAILABLE",
        details: { items: unavailable.map((p) => ({ id: p.id, name: p.name })) },
      });
    }
    const built = await buildOrderLines(store.id, products, input.items);
    if (!built.ok) return reply.code(built.status).send(built.body);
    const itemsData = built.lines;
    const { subtotalCents, totalCents: quotedTotalCents } = quoteOrder({ lineTotalsCents: itemsData.map((i) => i.lineTotalCents) }); // D5
    if (store.minOrderCents !== null && subtotalCents < store.minOrderCents) {
      return reply.code(400).send({ error: minOrderMessage(store.minOrderCents), code: "MIN_ORDER" });
    }

    if ((await prisma.order.count({ where: { storeId: store.id, tableId: table.id, status: { in: [...QUEUED_ORDER_STATUSES] } } })) >= QR_OPEN_CAP) {
      return reply.code(429).send({ error: "Há muitos pedidos abertos nesta mesa. Chame o atendente.", code: "TABLE_BUSY" });
    }

    // Token do aparelho: reaproveita o enviado; senão emite um novo (devolvido UMA vez). Só o hash vai ao banco.
    const sent = deviceTokenOf(request);
    const device = sent ? { token: sent, hash: hashToken(sent), issued: false } : { ...newDeviceToken(), issued: true };
    const orderToken = newOrderToken();
    const direct = !store.qrOrdersNeedApproval; // sem aceite: entra CONFIRMADO e vai à cozinha

    const order = await orderService.create({
      origin: "TABLE",
      storeId: store.id,
      items: itemsData,
      release: true, // decisão do Claudio (18/11): imprime AO CHEGAR, com ou sem aceite; o aceite só muda o estado
      fields: () => ({
        tableId: table.id,
        deviceTokenHash: device.hash,
        type: "MESA",
        status: direct ? "CONFIRMADO" : "PENDENTE",
        customerName: input.customerName?.normalize("NFC"),
        notes: input.notes,
        subtotalCents,
        totalCents: quotedTotalCents, // sem desconto, taxa nem forma de pagamento: o recebimento é na mesa (API-24)
        paymentMethod: null,
        awaitingPayment: false,
        publicTokenHash: orderToken.hash,
        statusHistory: { create: { status: direct ? "CONFIRMADO" : "PENDENTE" } },
      }),
    });
    // Rajada (RN-MB-08): muitos PENDENTE na mesma mesa => alerta no painel.
    if (!direct) {
      const pending = await prisma.order.count({ where: { storeId: store.id, tableId: table.id, status: "PENDENTE" } });
      if (pending >= QR_BURST_PENDING) publishToStore(store.id, { type: "table.alert", tableId: table.id, kind: "BURST" });
    }
    return reply.code(201).send({ orderId: order.id, code: order.code, status: order.status, token: orderToken.token, ...(device.issued ? { deviceToken: device.token } : {}) });
  });

  // "Minha mesa" (RN-MB-06): SÓ os pedidos deste aparelho, nesta mesa. Sem token válido: lista vazia (CA-MB-07), nunca o consumo da mesa.
  app.get("/stores/:slug/tables/:qrToken/my-orders", PUBLIC_LIMIT, async (request, reply) => {
    publicHeaders(reply);
    const { slug, qrToken } = request.params as { slug: string; qrToken: string };
    const found = await resolveTable(slug, qrToken);
    if (!found) return notFound(reply);
    const token = deviceTokenOf(request);
    const hash = hashToken(token ?? ""); // sempre calcula (tempo igual com ou sem token)
    const orders = token
      ? await prisma.order.findMany({
          where: { storeId: found.store.id, tableId: found.table.id, deviceTokenHash: hash },
          orderBy: { createdAt: "asc" },
          take: 100,
          select: {
            id: true,
            code: true,
            status: true,
            totalCents: true,
            createdAt: true,
            items: { select: {
              productName: true,
              quantity: true,
              unitPriceCents: true,
              notes: true,
              additionals: { select: { name: true, priceCents: true } },
              options: { select: { groupName: true, name: true, priceCents: true, quantity: true, priceMode: true } },
            } },
          },
        })
      : [];
    return { table: { label: found.table.label }, orders };
  });

  // "Chamar atendente" e "Pedir a conta" (RN-MB-09): só avisam a equipe; no máximo 1 por minuto por mesa e tipo.
  for (const [path, kind] of [["call-waiter", "CALL_WAITER"], ["ask-bill", "ASK_BILL"]] as const) {
    app.post(`/stores/:slug/tables/:qrToken/${path}`, PUBLIC_LIMIT, async (request, reply) => {
      publicHeaders(reply);
      const { slug, qrToken } = request.params as { slug: string; qrToken: string };
      const found = await resolveTable(slug, qrToken);
      if (!found) return notFound(reply);
      if (limited(`qr-alert:${found.table.id}:${kind}`, 1)) return reply.code(200).send({ notified: false, throttled: true });
      // SALÃO 3D: o aviso fica guardado até a equipe marcar como atendido (só grava a 1ª vez: mantém a hora original)
      await prisma.table.updateMany({ where: { id: found.table.id, ...(kind === "ASK_BILL" ? { askBillAt: null } : { callWaiterAt: null }) }, data: kind === "ASK_BILL" ? { askBillAt: new Date() } : { callWaiterAt: new Date() } });
      publishToStore(found.store.id, { type: "table.alert", tableId: found.table.id, kind });
      return reply.code(200).send({ notified: true });
    });
  }
};

export default tableRoutes;
