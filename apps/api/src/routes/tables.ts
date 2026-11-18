import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, prisma } from "@meucardapio/db";
import { createTableOrderSchema, createTableSchema, qrSettingsSchema, updateTableSchema } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { buildMenuView } from "../lib/menuView";
import { clientKey } from "../lib/clientKey";
import { nextOrderCode, ORDER_TX_OPTIONS } from "../lib/order-code";
import { newOrderToken } from "../lib/orderToken";
import { limited, tooMany } from "../lib/slidingLimit";
import { hashToken } from "../lib/tokenHash";
import { enqueueOrderTicket } from "../modules/printJobs/printJobs.queue";
import { publishToStore } from "../realtime/hub";
import { CodedError, useDomainErrors } from "../shared/errors";

// API-22 — mesa e QR (ADR-0002 nível 1; spec do Leonardo B, RN-MB-01..13).
// Segurança (ADR-0002 §7): o QR é estático e NÃO abre a conta da mesa. O primeiro pedido emite um token anônimo do APARELHO (256 bits; só o hash vai ao banco)
// e o cliente só vê os pedidos feitos com aquele token. Token inexistente, mesa inativa e slug divergente respondem o MESMO 404 (D2-3).

export const DEVICE_TOKEN_HEADER = "x-device-token";
const MAX_TOKEN_LENGTH = 200;
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
  return typeof raw === "string" && raw.length > 0 && raw.length <= MAX_TOKEN_LENGTH ? raw : null;
}

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
    const [store, tables, pending] = await Promise.all([
      prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { slug: true, qrOrderingEnabled: true, qrOrdersNeedApproval: true } }),
      prisma.table.findMany({ where: { storeId }, orderBy: [{ position: "asc" }, { label: "asc" }] }),
      prisma.order.groupBy({ by: ["tableId"], where: { storeId, tableId: { not: null }, status: "PENDENTE" }, _count: { _all: true } }),
    ]);
    const pendingBy = new Map(pending.map((p) => [p.tableId, p._count._all]));
    return {
      settings: { qrOrderingEnabled: store.qrOrderingEnabled, qrOrdersNeedApproval: store.qrOrdersNeedApproval },
      tables: tables.map((t) => ({ ...tableView(t, store.slug), pendingOrders: pendingBy.get(t.id) ?? 0 })),
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
      throw new CodedError(400, "CONFIRMATION_REQUIRED", "Qualquer pessoa com o QR poderá mandar pedido direto para a cozinha. Confirme para desligar o aceite.");
    }
    const store = await prisma.store.update({ where: { id: storeId }, data: { qrOrderingEnabled, qrOrdersNeedApproval }, select: { qrOrderingEnabled: true, qrOrdersNeedApproval: true } });
    logAudit({ storeId, userId, action: "store.qr_settings", targetType: "Store", targetId: storeId, metadata: { qrOrderingEnabled, qrOrdersNeedApproval } });
    return { settings: store };
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
    if (limited(`qr-order:${table.id}:${clientKey(request.ip)}`, 6) || limited(`qr-order-table:${table.id}`, 60)) return tooMany(reply);

    if (!store.qrOrderingEnabled) return reply.code(409).send({ error: "Esta loja não recebe pedidos pelo QR. Chame o atendente.", code: "QR_ORDERING_DISABLED" });
    if (!store.acceptingOrders) return reply.code(409).send({ error: "A loja não está aceitando pedidos no momento.", code: "STORE_CLOSED" });

    const parsed = createTableOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const input = parsed.data;

    const products = await prisma.product.findMany({ where: { storeId: store.id, id: { in: input.items.map((i) => i.productId) } }, include: { additionals: true } });
    if (products.length !== new Set(input.items.map((i) => i.productId)).size) {
      return reply.code(400).send({ error: "um ou mais produtos não existem nesta loja", code: "PRODUCT_NOT_FOUND" });
    }
    const unavailable = products.filter((p) => !p.active);
    if (unavailable.length > 0) {
      return reply.code(400).send({
        error: `Item indisponível no momento: ${unavailable.map((p) => p.name).join(", ")}.`,
        code: "ITEM_UNAVAILABLE",
        details: { items: unavailable.map((p) => ({ id: p.id, name: p.name })) },
      });
    }
    const productById = new Map(products.map((p) => [p.id, p]));
    let itemsData;
    try {
      itemsData = input.items.map((item) => {
        const product = productById.get(item.productId)!;
        const byId = new Map(product.additionals.map((a) => [a.id, a]));
        const chosen = (item.additionalIds ?? []).map((id) => {
          const additional = byId.get(id);
          if (!additional) throw new Error(`adicional ${id} não pertence ao produto ${product.id}`);
          return additional;
        });
        const extra = chosen.reduce((sum, a) => sum + a.priceCents, 0);
        return { productId: product.id, productName: product.name, quantity: item.quantity, unitPriceCents: product.priceCents, notes: item.notes, lineTotalCents: (product.priceCents + extra) * item.quantity, additionals: chosen };
      });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "pedido inválido", code: "ADDITIONAL_NOT_FOUND" });
    }
    const subtotalCents = itemsData.reduce((sum, i) => sum + i.lineTotalCents, 0);
    if (store.minOrderCents !== null && subtotalCents < store.minOrderCents) {
      return reply.code(400).send({ error: `pedido mínimo é R$ ${(store.minOrderCents / 100).toFixed(2)}`, code: "MIN_ORDER" });
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
            })),
          },
        },
      });
      // Com aceite, o tíquete da cozinha sai quando a equipe aceita (API-23); sem aceite, nasce junto do pedido.
      if (direct) ticketQueued = await enqueueOrderTicket(tx, { id: created.id, storeId: store.id });
      return created;
    }, ORDER_TX_OPTIONS);

    publishToStore(store.id, { type: "order.created", orderId: order.id });
    if (ticketQueued) publishToStore(store.id, { type: "print.available" });
    // Rajada (RN-MB-08): muitos PENDENTE na mesma mesa => alerta, nunca bloqueio.
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
          select: { id: true, code: true, status: true, totalCents: true, createdAt: true, items: { select: { productName: true, quantity: true, unitPriceCents: true, notes: true, additionals: { select: { name: true, priceCents: true } } } } },
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
