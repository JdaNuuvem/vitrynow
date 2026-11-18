import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { ONBOARDING_STEPS, isReservedSlug, onboardingStepStatusSchema, verifyEmailSchema, type OnboardingStepId } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { consumeVerificationToken, sendVerificationEmail } from "../lib/emailVerification";

const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/;
// Passos que o sistema enxerga sozinho nos dados da loja; os outros o dono marca (feito/pulado).
const AUTOMATIC: ReadonlySet<OnboardingStepId> = new Set(["STORE_DATA", "HOURS", "FIRST_PRODUCT", "PRINTER"]);
const ESSENTIAL: readonly OnboardingStepId[] = ["STORE_DATA", "HOURS", "FIRST_PRODUCT"]; // RN-ONB-05

// Cadastro, verificação de e-mail e checklist guiado (ONB). O envio de e-mail usa o provedor FALSO (lib/emailSender).
const onboardingRoutes: FastifyPluginAsync = async (app) => {
  // RN-ONB-02: disponibilidade do endereço na hora (público; limitado). Não diferencia "reservado" de "em uso" para quem só quer saber se serve.
  app.get("/auth/slug-availability", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const slug = String((request.query as { slug?: string }).slug ?? "").trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) return reply.code(400).send({ error: "use apenas letras minúsculas, números e hífen", code: "SLUG_INVALID" });
    if (isReservedSlug(slug)) return { slug, available: false, reason: "RESERVED" };
    const taken = await prisma.store.findUnique({ where: { slug }, select: { id: true } });
    return { slug, available: !taken, reason: taken ? "IN_USE" : null };
  });

  // Confirmação pelo link do e-mail. Público (a pessoa pode abrir em outro aparelho); uso único; resposta igual para token errado, usado ou vencido.
  app.post("/auth/verify-email", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = verifyEmailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await consumeVerificationToken(parsed.data.token);
    if (!result.ok) return reply.code(400).send({ error: "Link inválido ou vencido. Peça um novo e-mail.", code: "VERIFY_TOKEN_INVALID" });
    return { ok: true };
  });

  // "Reenviar e-mail" do banner. Qualquer usuário da loja pode pedir para si mesmo; 60 s entre pedidos e 5 por hora.
  app.post("/api/auth/verify-email/resend", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.userId }, select: { id: true, email: true, emailVerifiedAt: true } });
    if (!user) return reply.code(401).send({ error: "sessão inválida" });
    if (user.emailVerifiedAt) return { alreadyVerified: true };
    const result = await sendVerificationEmail(user);
    if ("limited" in result) {
      reply.header("Retry-After", String(result.retryAfterSeconds));
      return reply.code(429).send({ error: "Aguarde um pouco antes de pedir outro e-mail.", code: "VERIFY_RESEND_LIMITED", retryAfterSeconds: result.retryAfterSeconds });
    }
    if (!result.sent) return reply.code(503).send({ error: "Não conseguimos enviar o e-mail agora. Tente de novo em instantes.", code: "EMAIL_NOT_SENT" });
    return reply.code(202).send({ sent: true });
  });

  // Checklist guiado (ONB.2/ONB.3): estado de cada passo, progresso "x de 8", próximo passo e selo "Cardápio pronto para divulgar".
  app.get("/api/onboarding", { preHandler: app.requirePanelAuth }, async (request) => {
    const { storeId, userId } = request.user;
    const [store, user, productFirst, deviceSeen, orderFirst, marks] = await Promise.all([
      prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { address: true, whatsapp: true, logoUrl: true, primaryColor: true, openingHours: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } }),
      prisma.product.findFirst({ where: { storeId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.deviceToken.findFirst({ where: { storeId, revokedAt: null, lastSeenAt: { not: null } }, orderBy: { lastSeenAt: "asc" }, select: { lastSeenAt: true } }),
      prisma.order.findFirst({ where: { storeId, status: { not: "CANCELADO" }, awaitingPayment: false }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.onboardingStep.findMany({ where: { storeId } }),
    ]);
    const markOf = new Map(marks.map((m) => [m.step, m.status]));
    const autoDone: Record<string, boolean> = {
      STORE_DATA: Boolean(store.address || store.whatsapp || store.logoUrl || store.primaryColor),
      HOURS: Boolean(store.openingHours?.trim()),
      FIRST_PRODUCT: productFirst !== null,
      PRINTER: deviceSeen !== null,
    };
    const steps = ONBOARDING_STEPS.map((id) => {
      const mark = markOf.get(id);
      const status = AUTOMATIC.has(id) && autoDone[id] ? "DONE" : (mark ?? "PENDING");
      return { id, status, automatic: AUTOMATIC.has(id) };
    });

    // RN-ONB-06 / CA-ONB-07: um evento de ativação por loja e por marco, nunca duplicado (a chave é (loja, marco)).
    // Marco "MP conectado" fica de fora até existir o Mercado Pago por loja (API-07).
    const events: { kind: string; occurredAt: Date }[] = [];
    if (productFirst) events.push({ kind: "FIRST_PRODUCT", occurredAt: productFirst.createdAt });
    if (deviceSeen?.lastSeenAt) events.push({ kind: "PRINTER_ONLINE", occurredAt: deviceSeen.lastSeenAt });
    if (orderFirst) events.push({ kind: "FIRST_REAL_ORDER", occurredAt: orderFirst.createdAt });
    if (events.length > 0) await prisma.activationEvent.createMany({ data: events.map((e) => ({ storeId, ...e })), skipDuplicates: true });

    const doneCount = steps.filter((s) => s.status === "DONE").length;
    const next = steps.find((s) => s.status === "PENDING") ?? steps.find((s) => s.status === "SKIPPED") ?? null;
    return {
      emailVerified: Boolean(user?.emailVerifiedAt),
      steps,
      progress: { done: doneCount, total: ONBOARDING_STEPS.length },
      next: next?.id ?? null,
      readyToShare: ESSENTIAL.every((id) => steps.find((s) => s.id === id)?.status === "DONE"),
    };
  });

  // Pular ou retomar um passo; os que não são automáticos o dono também marca como feitos.
  app.post("/api/onboarding/steps/:step", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { step } = request.params as { step: string };
    if (!(ONBOARDING_STEPS as readonly string[]).includes(step)) return reply.code(404).send({ error: "passo não encontrado" });
    const parsed = onboardingStepStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { status } = parsed.data;
    if (status === "DONE" && AUTOMATIC.has(step as OnboardingStepId)) {
      return reply.code(400).send({ error: "Este passo é concluído sozinho quando a loja tem os dados.", code: "STEP_AUTOMATIC" });
    }
    if (status === "PENDING") await prisma.onboardingStep.deleteMany({ where: { storeId, step } });
    else await prisma.onboardingStep.upsert({ where: { storeId_step: { storeId, step } }, create: { storeId, step, status }, update: { status } });
    logAudit({ storeId, userId, action: "onboarding.step", targetType: "Store", targetId: storeId, metadata: { step, status } });
    return { step, status };
  });
};

export default onboardingRoutes;
