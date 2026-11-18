import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import {
  DELIVERY_ZONE_LIMIT,
  createDeliveryZoneSchema,
  deliveryZonesConfigSchema,
  importDeliveryZonesSchema,
  updateDeliveryZoneSchema,
} from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { parseZonePaste, zoneNameKey } from "../lib/deliveryZones";

const zoneSelect = { id: true, name: true, feeCents: true, etaMinMinutes: true, etaMaxMinutes: true, freeFromCents: true, active: true } as const;
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
const DUPLICATE = { error: "Já existe um bairro com esse nome.", code: "ZONE_DUPLICATE" };
const LIMIT = { error: `Limite de ${DELIVERY_ZONE_LIMIT} bairros por loja.`, code: "ZONE_LIMIT" };

// Taxa de entrega por bairro (B9). Leitura: painel (OWNER e STAFF). Escrita: só OWNER, sempre auditada (RN-B9-11).
const deliveryZoneRoutes: FastifyPluginAsync = async (app) => {
  const read = { preHandler: app.requirePanelAuth };
  const write = { preHandler: [app.requirePanelAuth, app.requireOwner] };

  app.get("/api/delivery-zones", read, async (request) => {
    const { storeId } = request.user;
    const [zones, store] = await Promise.all([
      prisma.deliveryZone.findMany({ where: { storeId }, orderBy: { name: "asc" }, select: zoneSelect }),
      prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { deliveryOutsideMode: true, freeShippingFromCents: true, deliveryFeeCents: true } }),
    ]);
    return { zones, config: { outsideMode: store.deliveryOutsideMode, freeShippingFromCents: store.freeShippingFromCents, defaultFeeCents: store.deliveryFeeCents } };
  });

  app.post("/api/delivery-zones", write, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = createDeliveryZoneSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if ((await prisma.deliveryZone.count({ where: { storeId } })) >= DELIVERY_ZONE_LIMIT) return reply.code(409).send(LIMIT);
    try {
      const zone = await prisma.deliveryZone.create({ data: { ...parsed.data, storeId, nameKey: zoneNameKey(parsed.data.name) }, select: zoneSelect });
      logAudit({ storeId, userId, action: "delivery_zone.create", targetType: "DeliveryZone", targetId: zone.id, metadata: parsed.data });
      return reply.code(201).send({ zone });
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(DUPLICATE);
      throw error;
    }
  });

  app.post("/api/delivery-zones/:id", write, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = updateDeliveryZoneSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const current = await prisma.deliveryZone.findFirst({ where: { id, storeId } });
    if (!current) return reply.code(404).send({ error: "bairro não encontrado" });
    const min = parsed.data.etaMinMinutes === undefined ? current.etaMinMinutes : parsed.data.etaMinMinutes;
    const max = parsed.data.etaMaxMinutes === undefined ? current.etaMaxMinutes : parsed.data.etaMaxMinutes;
    if (min != null && max != null && min > max) return reply.code(400).send({ error: "o prazo mínimo não pode passar do máximo" });
    try {
      const zone = await prisma.deliveryZone.update({
        where: { id },
        data: { ...parsed.data, ...(parsed.data.name ? { nameKey: zoneNameKey(parsed.data.name) } : {}) },
        select: zoneSelect,
      });
      logAudit({ storeId, userId, action: "delivery_zone.update", targetType: "DeliveryZone", targetId: id, metadata: { before: { name: current.name, feeCents: current.feeCents, active: current.active }, after: parsed.data } });
      return { zone };
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(DUPLICATE);
      throw error;
    }
  });

  app.post("/api/delivery-zones/:id/delete", write, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const current = await prisma.deliveryZone.findFirst({ where: { id, storeId } });
    if (!current) return reply.code(404).send({ error: "bairro não encontrado" });
    await prisma.deliveryZone.delete({ where: { id } });
    logAudit({ storeId, userId, action: "delivery_zone.delete", targetType: "DeliveryZone", targetId: id, metadata: { name: current.name, feeCents: current.feeCents } });
    return { ok: true };
  });

  // Colar "nome; taxa" (uma por linha). dryRun=true só mostra o que entraria e os erros por linha (CA-B9-08).
  app.post("/api/delivery-zones/import", write, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = importDeliveryZonesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const existing = await prisma.deliveryZone.findMany({ where: { storeId }, select: { nameKey: true } });
    const { valid, errors } = parseZonePaste(parsed.data.text, new Set(existing.map((z) => z.nameKey)));
    const room = DELIVERY_ZONE_LIMIT - existing.length;
    const accepted = valid.slice(0, Math.max(room, 0));
    for (const over of valid.slice(accepted.length)) errors.push({ line: over.line, text: `${over.name}; ${over.feeCents}`, reason: `Limite de ${DELIVERY_ZONE_LIMIT} bairros por loja` });
    errors.sort((a, b) => a.line - b.line);
    if (!parsed.data.dryRun && accepted.length > 0) {
      await prisma.deliveryZone.createMany({ data: accepted.map((z) => ({ storeId, name: z.name, nameKey: zoneNameKey(z.name), feeCents: z.feeCents })), skipDuplicates: true });
      logAudit({ storeId, userId, action: "delivery_zone.import", targetType: "Store", targetId: storeId, metadata: { imported: accepted.length, rejected: errors.length } });
    }
    return { dryRun: parsed.data.dryRun === true, accepted: accepted.map(({ line, name, feeCents }) => ({ line, name, feeCents })), errors };
  });

  // "Outros bairros" (recusar | taxa padrão) e frete grátis geral.
  app.post("/api/delivery-zones/config", write, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = deliveryZonesConfigSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const store = await prisma.store.update({
      where: { id: storeId },
      data: { deliveryOutsideMode: parsed.data.outsideMode, freeShippingFromCents: parsed.data.freeShippingFromCents },
      select: { deliveryOutsideMode: true, freeShippingFromCents: true, deliveryFeeCents: true },
    });
    logAudit({ storeId, userId, action: "delivery_zone.config", targetType: "Store", targetId: storeId, metadata: parsed.data });
    return { config: { outsideMode: store.deliveryOutsideMode, freeShippingFromCents: store.freeShippingFromCents, defaultFeeCents: store.deliveryFeeCents } };
  });

  // Público: bairros ativos para o cliente escolher (só campos de exibição, só desta loja).
  app.get("/stores/:slug/delivery-zones", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const store = await prisma.store.findUnique({ where: { slug }, select: { id: true, deliveryOutsideMode: true, freeShippingFromCents: true, deliveryFeeCents: true } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });
    const zones = await prisma.deliveryZone.findMany({ where: { storeId: store.id, active: true }, orderBy: { name: "asc" }, select: zoneSelect });
    return { zones, outsideMode: store.deliveryOutsideMode, freeShippingFromCents: store.freeShippingFromCents, defaultFeeCents: store.deliveryFeeCents };
  });
};

export default deliveryZoneRoutes;
