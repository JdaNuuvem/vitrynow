import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma, type Plan, type Subscription } from "@meucardapio/db";
import {
  resolveEntitlements,
  type Access,
  type Entitlements,
  type LimitKey,
  type Phase,
  type PlanLimits,
} from "./entitlements";
import type { Feature } from "./features";

export { FEATURES, type Feature } from "./features";
export type { Access, Entitlements, LimitKey, Phase, PlanLimits } from "./entitlements";

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_THRESHOLD_DAYS = 3;
export const PERIOD_DAYS = 30;

/** Plano cujo conteúdo vale durante o teste (D2/CA-B10-03). */
export const TRIAL_PLAN_CODE = "BASICO";

export type SubscriptionState = "trial" | "active" | "canceled" | "past_due" | "expired";

export type SubscriptionView = {
  state: SubscriptionState;
  planCode: string | null;
  planName: string | null;
  features: Feature[];
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  daysLeft: number;
  /** Fase do ADR-0003 (TRIAL/ACTIVE/READ_ONLY/SUSPENDED); `state` acima é o formato legado do banner. */
  phase: Phase;
  readOnlyEndsAt: string | null;
  limits: PlanLimits;
  access: Access;
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

// `basicPlan` é o plano BASICO lido do banco: vale durante o teste. Sem ele, o teste não libera
// recurso algum e usa os limites padrão do BASICO (o mais restritivo).
export function resolveSubscription(
  subscription: SubscriptionWithPlan,
  now: Date = new Date(),
  basicPlan: Plan | null = null,
): SubscriptionView {
  const entitlements = resolveEntitlements(subscription, basicPlan, now);
  const base = {
    planCode: subscription.plan?.code ?? null,
    planName: subscription.plan?.name ?? null,
    trialEndsAt: subscription.trialEndsAt.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    features: entitlements.features,
    phase: entitlements.phase,
    readOnlyEndsAt: entitlements.readOnlyEndsAt,
    limits: entitlements.limits,
    access: entitlements.access,
  };
  const periodEnd = subscription.currentPeriodEnd;
  const periodRunning = periodEnd !== null && periodEnd > now;

  if (subscription.status === "TRIAL") {
    return subscription.trialEndsAt > now
      ? { ...base, state: "trial", daysLeft: daysUntil(subscription.trialEndsAt, now) }
      : { ...base, state: "expired", daysLeft: 0 };
  }

  if (subscription.status === "ACTIVE") {
    return periodRunning
      ? { ...base, state: "active", daysLeft: daysUntil(periodEnd, now) }
      : { ...base, state: "past_due", daysLeft: 0 };
  }

  return periodRunning
    ? { ...base, state: "canceled", daysLeft: daysUntil(periodEnd, now) }
    : { ...base, state: "expired", daysLeft: 0 };
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

async function loadBasicPlan(): Promise<Plan | null> {
  return prisma.plan.findUnique({ where: { code: TRIAL_PLAN_CODE } });
}

/** Assinatura da loja já resolvida (fase, recursos, limites e acesso). Nada em cache: reativar libera na hora. */
export async function getSubscriptionView(storeId: string, now: Date = new Date()): Promise<SubscriptionView> {
  const [subscription, basicPlan] = await Promise.all([getStoreSubscription(storeId), loadBasicPlan()]);
  return resolveSubscription(subscription, now, basicPlan);
}

/** Fonte única de verdade do que a loja pode usar agora (ADR-0003 §2.1). */
export async function getEntitlements(storeId: string, now: Date = new Date()): Promise<Entitlements> {
  const view = await getSubscriptionView(storeId, now);
  return { phase: view.phase, readOnlyEndsAt: view.readOnlyEndsAt, features: view.features, limits: view.limits, access: view.access };
}

// preHandler: encadear depois de requirePanelAuth. Recurso fora do plano → 402 FEATURE_LOCKED.
export function requireFeature(feature: Feature) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const entitlements = await getEntitlements(request.user.storeId);
    if (!entitlements.features.includes(feature)) {
      reply
        .code(402)
        .send({ error: "Este recurso não está disponível no seu plano.", code: "FEATURE_LOCKED", feature, details: { feature } });
    }
  };
}

/**
 * preHandler de limite do plano (maxUsers, maxPrinters): `countCurrent` devolve quantos já existem
 * (só os ativos). Ao atingir o máximo → 402 LIMIT_REACHED. Sem limite (`null`) nunca bloqueia.
 * Limitação conhecida: duas criações simultâneas podem passar do limite em 1 (verificação e
 * criação não são atômicas); o impacto é pequeno e vale o aceite de RN-B10-03.
 */
export function requireLimit(limit: LimitKey, countCurrent: (request: FastifyRequest) => Promise<number>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const max = (await getEntitlements(request.user.storeId)).limits[limit];
    if (max === null) return;
    const current = await countCurrent(request);
    if (current >= max) {
      reply
        .code(402)
        .send({ error: "Você atingiu o limite do seu plano.", code: "LIMIT_REACHED", details: { limit, max, current } });
    }
  };
}

export function newTrialEndsAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + trialDays() * DAY_MS);
}
