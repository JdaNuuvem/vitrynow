import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { storeAvailabilitySchema, updateStoreSettingsSchema } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { bannerStateOf, getSubscriptionView } from "../lib/subscription";

// Conta/personalização da loja (nome, logo, cor, domínio) — autenticado pelo painel.
const storeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/store/settings", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId } = request.user;
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        slug: true,
        code: true,
        logoUrl: true,
        coverImageUrl: true,
        primaryColor: true,
        customDomain: true,
        address: true,
        whatsapp: true,
        openingHours: true,
        minOrderCents: true,
        deliveryEnabled: true,
        pickupEnabled: true,
        acceptingOrders: true,
        hideSoldOutProducts: true,
        deliveryFeeCents: true,
      },
    });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });
    return { store };
  });

  // Estado do período de teste/assinatura no formato do banner do painel; o detalhe completo
  // (plano, recursos, vencimento) fica em GET /api/store/subscription.
  app.get("/api/store/plan", { preHandler: app.requirePanelAuth }, async (request) => {
    const view = await getSubscriptionView(request.user.storeId);
    return { plan: { trialEndsAt: view.trialEndsAt, daysLeft: view.daysLeft, state: bannerStateOf(view) } };
  });

  // Interruptor "Disponível" do painel: com acceptingOrders=false o cardápio público recusa pedidos.
  app.post("/api/store/availability", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = storeAvailabilitySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const store = await prisma.store.update({
      where: { id: storeId },
      data: { acceptingOrders: parsed.data.acceptingOrders },
      select: { acceptingOrders: true },
    });
    logAudit({ storeId, userId, action: "store.availability", targetType: "Store", targetId: storeId, metadata: parsed.data });
    return { store };
  });

  app.post("/api/store/settings", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    const { storeId } = request.user;
    const parsed = updateStoreSettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { logoUrl, coverImageUrl, primaryColor, customDomain, address, whatsapp, openingHours, ...rest } = parsed.data;
    // SEC-14 (ST-18): o domínio é ÚNICO no banco; quem decide é o índice (sem "consultar e depois gravar"), então duas lojas simultâneas não passam as duas.
    const store = await prisma.store.update({
      where: { id: storeId },
      data: {
        ...rest,
        logoUrl: logoUrl === "" ? null : logoUrl,
        coverImageUrl: coverImageUrl === "" ? null : coverImageUrl,
        primaryColor: primaryColor === "" ? null : primaryColor,
        customDomain: customDomain === "" ? null : customDomain,
        address: address === "" ? null : address,
        whatsapp: whatsapp === "" ? null : whatsapp,
        openingHours: openingHours === "" ? null : openingHours,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        code: true,
        logoUrl: true,
        coverImageUrl: true,
        primaryColor: true,
        customDomain: true,
        address: true,
        whatsapp: true,
        openingHours: true,
        minOrderCents: true,
        deliveryEnabled: true,
        pickupEnabled: true,
        acceptingOrders: true,
        hideSoldOutProducts: true,
        deliveryFeeCents: true,
      },
    }).catch((error: unknown) => {
      const known = error as { code?: string; meta?: { target?: string[] | string } };
      const target = Array.isArray(known.meta?.target) ? known.meta.target.join(",") : String(known.meta?.target ?? "");
      if (known.code === "P2002" && target.includes("customDomain")) return null;
      throw error;
    });
    if (!store) return reply.code(409).send({ error: "este domínio já está em uso por outra loja", code: "CUSTOM_DOMAIN_TAKEN" });
    logAudit({ storeId, userId: request.user.userId, action: "store.settings_update", targetType: "Store", targetId: storeId, metadata: parsed.data });
    return { store };
  });
};

export default storeRoutes;
