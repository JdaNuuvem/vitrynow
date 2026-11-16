import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { checkoutPlanSchema } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { createPixPayment } from "../lib/mercadopago";
import { isFeature, isProFeature } from "../lib/features";
import { getEntitlements, getStoreSubscription, getSubscriptionView } from "../lib/subscription";

// Planos e assinatura da loja. Cobrança por PIX (Mercado Pago, conta da plataforma);
// a confirmação chega pelo webhook em routes/payments.ts, que ativa o período de 30 dias.
const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/plans", { preHandler: app.requirePanelAuth }, async () => {
    const plans = await prisma.plan.findMany({
      where: { active: true },
      orderBy: { position: "asc" },
      select: { code: true, name: true, priceCents: true, features: true, limits: true },
    });
    return { plans };
  });

  app.get("/api/store/subscription", { preHandler: app.requirePanelAuth }, async (request) => {
    return { subscription: await getSubscriptionView(request.user.storeId) };
  });

  // "Quero ser avisado" (RN-B10-05): grava o interesse da loja num recurso que o plano não tem.
  // Idempotente (um registro por loja e recurso) e sem prometer data nem preço.
  app.post(
    "/api/store/feature-interest",
    { preHandler: app.requirePanelAuth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { storeId, userId } = request.user;
      const { feature } = (request.body ?? {}) as { feature?: unknown };
      if (typeof feature !== "string" || !isFeature(feature)) {
        return reply.code(400).send({ error: "recurso desconhecido", code: "VALIDATION_ERROR", details: { field: "feature" } });
      }
      // Recurso do BASICO (ex.: QR de mesa) já é do plano do lojista: não há o que "ser avisado" sobre upgrade.
      if (!isProFeature(feature) || (await getEntitlements(storeId)).features.includes(feature)) {
        return reply.code(409).send({ error: "seu plano já inclui esse recurso", code: "FEATURE_ALREADY_AVAILABLE" });
      }

      const existing = await prisma.featureInterest.findUnique({ where: { storeId_feature: { storeId, feature } } });
      if (!existing) {
        await prisma.featureInterest.upsert({ where: { storeId_feature: { storeId, feature } }, update: {}, create: { storeId, feature } });
        logAudit({ storeId, userId, action: "feature_interest.create", targetType: "FeatureInterest", targetId: feature });
      }
      return { ok: true };
    },
  );

  app.post(
    "/api/store/subscription/checkout",
    { preHandler: [app.requirePanelAuth, app.requireOwner], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { storeId, userId } = request.user;
      const parsed = checkoutPlanSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const plan = await prisma.plan.findFirst({ where: { code: parsed.data.planCode, active: true } });
      if (!plan) return reply.code(404).send({ error: "plano não encontrado" });

      const [subscription, store, user] = await Promise.all([
        getStoreSubscription(storeId),
        prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { name: true } }),
        prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
      ]);

      const payment = await prisma.subscriptionPayment.create({
        data: { subscriptionId: subscription.id, planCode: plan.code, amountCents: plan.priceCents },
      });

      try {
        const pix = await createPixPayment({
          orderId: payment.id,
          amountCents: plan.priceCents,
          description: `Assinatura ${plan.name} — ${store.name}`,
          payerEmail: user.email,
        });
        const updated = await prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: pix.providerPaymentId,
            pixQrCode: pix.pixQrCode,
            pixQrCodeBase64: pix.pixQrCodeBase64,
            expiresAt: pix.expiresAt,
          },
        });
        logAudit({ storeId, userId, action: "subscription.checkout", targetType: "Plan", targetId: plan.code });
        return reply.code(201).send({
          payment: {
            id: updated.id,
            amountCents: updated.amountCents,
            pixQrCode: updated.pixQrCode,
            pixQrCodeBase64: updated.pixQrCodeBase64,
            expiresAt: updated.expiresAt,
          },
        });
      } catch (error) {
        app.log.error({ err: error }, "falha ao gerar o pagamento PIX da assinatura");
        await prisma.subscriptionPayment.delete({ where: { id: payment.id } });
        return reply.code(502).send({ error: "não foi possível gerar o pagamento PIX, tente novamente" });
      }
    },
  );

  // Consultado pela tela de planos enquanto aguarda a confirmação do PIX.
  app.get("/api/store/subscription/payments/:id", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const subscription = await getStoreSubscription(request.user.storeId);
    const payment = await prisma.subscriptionPayment.findFirst({ where: { id, subscriptionId: subscription.id } });
    if (!payment) return reply.code(404).send({ error: "pagamento não encontrado" });
    return { status: payment.status, subscription: await getSubscriptionView(request.user.storeId) };
  });

  app.post("/api/store/subscription/cancel", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const subscription = await getStoreSubscription(storeId);
    if (subscription.status !== "ACTIVE") {
      return reply.code(409).send({ error: "só é possível cancelar uma assinatura ativa" });
    }

    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: "CANCELED", canceledAt: new Date() } });
    logAudit({ storeId, userId, action: "subscription.cancel", targetType: "Subscription", targetId: subscription.id });
    return { subscription: await getSubscriptionView(storeId) };
  });
};

export default subscriptionRoutes;
