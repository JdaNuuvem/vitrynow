import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma, type Plan, type Subscription } from "@meucardapio/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_THRESHOLD_DAYS = 3;
export const PERIOD_DAYS = 30;

export const FEATURES = ["multi_user"] as const;
export type Feature = (typeof FEATURES)[number];

export type SubscriptionState = "trial" | "active" | "canceled" | "past_due" | "expired";

export type SubscriptionView = {
  state: SubscriptionState;
  planCode: string | null;
  planName: string | null;
  features: Feature[];
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  daysLeft: number;
};

export type BannerState = "info" | "warning" | "expired" | "active";

export function trialDays(): number {
  const configured = Number(process.env.TRIAL_DAYS);
  return Number.isFinite(configured) && configured > 0 ? configured : 14;
}

function daysUntil(target: Date, now: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY_MS));
}

type SubscriptionWithPlan = Subscription & { plan: Plan | null };

function planFeatures(plan: Plan | null): Feature[] {
  return (plan?.features ?? []).filter((feature): feature is Feature => (FEATURES as readonly string[]).includes(feature));
}

export function resolveSubscription(subscription: SubscriptionWithPlan, now: Date = new Date()): SubscriptionView {
  const base = {
    planCode: subscription.plan?.code ?? null,
    planName: subscription.plan?.name ?? null,
    trialEndsAt: subscription.trialEndsAt.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
  };
  const periodEnd = subscription.currentPeriodEnd;
  const periodRunning = periodEnd !== null && periodEnd > now;

  if (subscription.status === "TRIAL") {
    if (subscription.trialEndsAt > now) {
      return { ...base, state: "trial", features: [...FEATURES], daysLeft: daysUntil(subscription.trialEndsAt, now) };
    }
    return { ...base, state: "expired", features: [], daysLeft: 0 };
  }

  if (subscription.status === "ACTIVE") {
    return periodRunning
      ? { ...base, state: "active", features: planFeatures(subscription.plan), daysLeft: daysUntil(periodEnd, now) }
      : { ...base, state: "past_due", features: [], daysLeft: 0 };
  }

  return periodRunning
    ? { ...base, state: "canceled", features: planFeatures(subscription.plan), daysLeft: daysUntil(periodEnd, now) }
    : { ...base, state: "expired", features: [], daysLeft: 0 };
}

// Estado que o banner do painel entende: durante o teste avisa; em dia, some.
export function bannerStateOf(view: SubscriptionView): BannerState {
  if (view.state === "expired" || view.state === "past_due") return "expired";
  if (view.state === "trial") return view.daysLeft <= WARNING_THRESHOLD_DAYS ? "warning" : "info";
  return "active";
}

export function hasFeature(view: SubscriptionView, feature: Feature): boolean {
  return view.features.includes(feature);
}

export async function getStoreSubscription(storeId: string): Promise<SubscriptionWithPlan> {
  const existing = await prisma.subscription.findUnique({ where: { storeId }, include: { plan: true } });
  if (existing) return existing;

  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { createdAt: true } });
  return prisma.subscription.upsert({
    where: { storeId },
    update: {},
    create: { storeId, trialEndsAt: new Date(store.createdAt.getTime() + trialDays() * DAY_MS) },
    include: { plan: true },
  });
}

// `db` permite ativar DENTRO da transação que marcou o pagamento como aprovado (sem janela entre os dois).
export async function activateSubscription(
  input: { subscriptionId: string; planCode: string; now?: Date },
  db: Pick<typeof prisma, "plan" | "subscription"> = prisma,
) {
  const now = input.now ?? new Date();
  const plan = await db.plan.findUniqueOrThrow({ where: { code: input.planCode } });
  const subscription = await db.subscription.findUniqueOrThrow({ where: { id: input.subscriptionId } });

  const renewsFrom =
    subscription.status === "ACTIVE" && subscription.currentPeriodEnd && subscription.currentPeriodEnd > now
      ? subscription.currentPeriodEnd
      : now;

  return db.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "ACTIVE",
      planId: plan.id,
      canceledAt: null,
      currentPeriodEnd: new Date(renewsFrom.getTime() + PERIOD_DAYS * DAY_MS),
    },
  });
}

// preHandler: encadear depois de requirePanelAuth. Recurso fora do plano → 402.
export function requireFeature(feature: Feature) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const view = resolveSubscription(await getStoreSubscription(request.user.storeId));
    if (!hasFeature(view, feature)) {
      return reply.code(402).send({ error: "Este recurso não está disponível no seu plano.", code: "FEATURE_LOCKED", feature });
    }
  };
}

export function newTrialEndsAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + trialDays() * DAY_MS);
}
