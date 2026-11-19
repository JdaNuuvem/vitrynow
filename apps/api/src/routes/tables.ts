import { clientIpOf } from "../lib/clientIp";
import { buildOrderLines, optionCopiesCreate, orderItemExtras } from "../lib/orderItems";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, prisma } from "@meucardapio/db";
import { createTableOrderSchema, createTableSchema, qrSettingsSchema, receiveTableSchema, updateTableSchema } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { buildMenuView } from "../lib/menuView";
import { clientKey } from "../lib/clientKey";
import { nextOrderCode, ORDER_TX_OPTIONS } from "../lib/order-code";
import { newOrderToken } from "../lib/orderToken";
import { toOrderPaymentMethod } from "../lib/paymentMethod";
import { SALE_STATUSES } from "../lib/saleLines";
import { limited, tooMany } from "../lib/slidingLimit";
import { isSoldOutNow } from "../lib/soldOut";
import { hashToken } from "../lib/tokenHash";
import { enqueueOrderTicket } from "../modules/printJobs/printJobs.queue";
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

const tableView = (t: { id: string; label: string; qrToken: string; active: boolean; position: number }, slug: string) => ({
  id: t.id,
  label: t.label,
  active: t.active,
  position: t.position,
  qrToken: t.qrToken,
  qrPath: `/loja/${slug}/m/${t.qrToken}`,
});

const tableRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  useDomainErrors(app);

  // ---------- Painel ----------
  app.get("/api/tables", { preHandler: app.requirePanelAuth }, async (request) => {
    const { storeId } = request.user;
    const [store, tables, pending, account] = await Promise.all([
      prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { slug: true, qrOrderingEnabled: true, qrOrdersNeedApproval: true } }),
      prisma.table.findMany({ where: { storeId }, orderBy: [{ position: "asc" }, { label: "asc" }] }),
      prisma.order.groupBy({ by: ["tableId"], where: { storeId, tableId: { not: null }, receiptId: null, status: "PENDENTE" }, _count: { _all: true } }),
      prisma.order.groupBy({ by: ["tableId"], where: { storeId, tableId: { not: null }, receiptId: null, paidAt: null, awaitingPayment: false, status: { in: [...SALE_STATUSES] } }, _count: { _all: true }, _sum: { totalCents: true } }),
    ]);
    const pendingBy = new Map(pending.map((p) => [p.tableId, p._count._all]));
    const accountBy = new Map(account.map((a) => [a.tableId, { count: a._count._all, totalCents: a._sum.totalCents ?? 0 }]));
    return {
      settings: { qrOrderingEnabled: store.qrOrderingEnabled, qrOrdersNeedApproval: store.qrOrdersNeedApproval },
      tables: tables.map((t) => {
        const acc = accountBy.get(t.id);
        const pendingOrders = pendingBy.get(t.id) ?? 0;
        // RN-MB-02: livre = sem pedido aceito a receber e sem pedido PENDENTE.
        return { ...tableView(t, store.slug), pendingOrders, accountOrders: acc?.count ?? 0, accountCents: acc?.totalCents ?? 0, free: pendingOrders === 0 && !acc };
      }),
    };
  });

  app.post("/api/tables", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = createTableSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { slug: true } });
    try {
      const table = await prisma.table.create({ data: { storeId, label: parsed.data.label, position: parsed.data.position ?? 0, qrToken: newQrToken() } });
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
    const { qrOrderingEnabled, qrOrdersNeedApproval, confirmNoApproval } = parsed.data;
    if (qrOrdersNeedApproval === false && !confirmNoApproval) {
      throw new CodedError(400, "CONFIRMATION_REQUIRED", "Sem o aceite, qualquer pessoa com o QR poderá lançar pedidos já aceitos, que entram direto no andamento da cozinha. Confirme para desligar o aceite.");
    }
    const store = await prisma.store.update({ where: { id: storeId }, data: { qrOrderingEnabled, qrOrdersNeedApproval }, select: { qrOrderingEnabled: true, qrOrdersNeedApproval: true } });
    logAudit({ storeId, userId, action: "store.qr_settings", targetType: "Store", targetId: storeId, metadata: { qrOrderingEnabled, qrOrdersNeedApproval } });
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

  // RECEBER A MESA (API-24; RN-MB-03/04/05, ADR-0012): soma a conta no SERVIDOR e grava UM Receipt com UMA forma de pagamento, marcando os pedidos.
  app.post("/api/tables/:id/receive", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    if (limited(`table-receive:${userId}`, RECEIVES_PER_MINUTE)) return tooMany(reply);
    const parsed = receiveTableSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const input = parsed.data;
    const method = toOrderPaymentMethod(input.paymentMethod);
    if (!method) return reply.code(400).send({ error: "Forma de pagamento inválida.", code: "PAYMENT_METHOD_REQUIRED" });
    if (input.changeForCents !== undefined && method !== "DINHEIRO") return reply.code(400).send({ error: "troco só se aplica a pagamento em dinheiro", code: "CHANGE_ONLY_CASH" });
    const table = await prisma.table.findFirst({ where: { id, storeId }, select: { id: true } });
    if (!table) return notFound(reply);

    const receipt = await prisma.$transaction(async (tx) => {
      // Trava os pedidos da mesa: cancelar e receber ao mesmo tempo se enfileiram (o cancelamento só vale com receiptId nulo).
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "storeId" = ${storeId} AND "tableId" = ${id} AND "receiptId" IS NULL FOR UPDATE`;
      // CA-MB-13: pedido PENDENTE bloqueia; aceitar ou recusar antes.
      const pending = await tx.order.count({ where: { storeId, tableId: id, receiptId: null, status: "PENDENTE" } });
      if (pending > 0) throw new CodedError(409, "PENDING_ORDERS", "Aceite ou recuse os pedidos pendentes da mesa antes de receber.", { details: { pendingOrders: pending } });
      const orders = await tx.order.findMany({ where: accountWhere(storeId, id), select: { id: true, totalCents: true } });
      const totalCents = orders.reduce((sum, o) => sum + o.totalCents, 0);
      if (orders.length === 0 || totalCents <= 0) throw new CodedError(409, "NOTHING_TO_RECEIVE", "Esta mesa não tem conta a receber.");
      if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== totalCents) {
        throw new CodedError(409, "TOTAL_CHANGED", "A conta da mesa mudou. Confira o novo total.", { details: { totalCents } });
      }
      if (input.changeForCents !== undefined && input.changeForCents < totalCents) throw new CodedError(400, "CHANGE_TOO_LOW", "o valor para troco deve cobrir o total da mesa");
      // RN-MB-03/CA-MB-04: dinheiro só com caixa ABERTO. FOR SHARE: o fechamento (FOR UPDATE) espera este recebimento terminar.
      let cashSessionId: string | null = null;
      if (method === "DINHEIRO") {
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
          subtotalCents: totalCents,
          totalCents,
          receivedAt,
          receivedByUserId: userId,
          cashSessionId,
          payments: { create: { method, amountCents: totalCents, changeForCents: input.changeForCents ?? null } },
        },
        include: { payments: true },
      });
      const marked = await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) }, storeId, receiptId: null }, data: { receiptId: created.id, paidAt: receivedAt } });
      if (marked.count !== orders.length) throw new CodedError(409, "ORDER_STATE_CHANGED", "A conta da mesa mudou enquanto você agia. Atualize a tela.");
      return { ...created, orderIds: orders.map((o) => o.id) };
    }, ORDER_TX_OPTIONS);

    logAudit({ storeId, userId, action: "table.receive", targetType: "Receipt", targetId: receipt.id, metadata: { tableId: id, method, totalCents: receipt.totalCents, orders: receipt.orderIds.length } });
    for (const orderId of receipt.orderIds) publishToStore(storeId, { type: "order.updated", orderId });
    return reply.code(201).send({
      receipt: {
        id: receipt.id,
        totalCents: receipt.totalCents,
        receivedAt: receipt.receivedAt,
        method,
        changeForCents: input.changeForCents ?? null,
        changeDueCents: input.changeForCents !== undefined ? input.changeForCents - receipt.totalCents : null,
        orderIds: receipt.orderIds,
      },
    });
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
      return reply.code(400).send({ error: "um ou mais produtos não existem nesta loja", code: "PRODUCT_NOT_FOUND" });
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
    const subtotalCents = itemsData.reduce((sum, i) => sum + i.lineTotalCents, 0);
    if (store.minOrderCents !== null && subtotalCents < store.minOrderCents) {
      return reply.code(400).send({ error: `pedido mínimo é R$ ${(store.minOrderCents / 100).toFixed(2)}`, code: "MIN_ORDER" });
    }

    if ((await prisma.order.count({ where: { storeId: store.id, tableId: table.id, status: { in: ["PENDENTE", "CONFIRMADO", "EM_PREPARO"] } } })) >= QR_OPEN_CAP) {
      return reply.code(429).send({ error: "Há muitos pedidos abertos nesta mesa. Chame o atendente.", code: "TABLE_BUSY" });
    }

    // Token do aparelho: reaproveita o enviado; senão emite um novo (devolvido UMA vez). Só o hash vai ao banco.
    const sent = deviceTokenOf(request);
    const device = sent ? { token: sent, hash: hashToken(sent), issued: false } : { ...newDeviceToken(), issued: true };
    const orderToken = newOrderToken();
    const direct = !store.qrOrdersNeedApproval; // sem aceite: entra CONFIRMADO e vai à cozinha

    let ticketQueued = false;
    const order = await prisma.$transaction(async (tx) => {
      const code = await nextOrderCode(tx, store.id);
      const created = await tx.order.create({
        data: {
          storeId: store.id,
          tableId: table.id,
          deviceTokenHash: device.hash,
          code,
          type: "MESA",
          source: "QR_MESA",
          status: direct ? "CONFIRMADO" : "PENDENTE",
          customerName: input.customerName?.normalize("NFC"),
          notes: input.notes,
          subtotalCents,
          totalCents: subtotalCents, // sem desconto, taxa nem forma de pagamento: o recebimento é na mesa (API-24)
          paymentMethod: null,
          awaitingPayment: false,
          publicTokenHash: orderToken.hash,
          statusHistory: { create: { status: direct ? "CONFIRMADO" : "PENDENTE" } },
          items: {
            create: itemsData.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              notes: item.notes,
              additionals: { create: item.additionals.map((a) => ({ name: a.name, priceCents: a.priceCents })) },
              ...optionCopiesCreate(item.optionCopies),
              ...orderItemExtras(item),
            })),
          },
        },
      });
      // Decisão do Claudio (18/11): imprime AO CHEGAR, com ou sem aceite; o aceite só muda o estado. O tíquete nasce na MESMA transação (nunca pedido sem job).
      ticketQueued = await enqueueOrderTicket(tx, { id: created.id, storeId: store.id });
      return created;
    }, ORDER_TX_OPTIONS);

    publishToStore(store.id, { type: "order.created", orderId: order.id });
    if (ticketQueued) publishToStore(store.id, { type: "print.available" });
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
      publishToStore(found.store.id, { type: "table.alert", tableId: found.table.id, kind });
      return reply.code(200).send({ notified: true });
    });
  }
};

export default tableRoutes;
