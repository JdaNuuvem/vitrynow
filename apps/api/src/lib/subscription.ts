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
  /** Próxima mudança de fase se nada acontecer (WEB-07: faixas e contagem regressiva). */
  nextPhaseAt: string | null;
  /** Atalho de `access.canFinishInProgress` (WEB-07: botões ativos na Consulta). */
  canFinishInProgress: boolean;
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
    nextPhaseAt: entitlements.nextPhaseAt,
    canFinishInProgress: entitlements.access.canFinishInProgress,
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
  return { phase: view.phase, readOnlyEndsAt: view.readOnlyEndsAt, nextPhaseAt: view.nextPhaseAt, features: view.features, limits: view.limits, access: view.access };
}

// Uma consulta por requisição: o portão de assinatura (plugins/subscriptionGate.ts), requireFeature e
// requireLimit compartilham o mesmo resultado. Vive só durante a requisição (nada de cache entre
// requisições: reativar a loja libera na hora).
const requestEntitlements = new WeakMap<FastifyRequest, Promise<Entitlements>>();

export function getRequestEntitlements(request: FastifyRequest, storeId: string): Promise<Entitlements> {
  let pending = requestEntitlements.get(request);
  if (!pending) {
    pending = getEntitlements(storeId);
    requestEntitlements.set(request, pending);
  }
  return pending;
}

// preHandler: encadear depois de requirePanelAuth. Recurso fora do plano → 402 FEATURE_LOCKED.
export function requireFeature(feature: Feature) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const entitlements = await getRequestEntitlements(request, request.user.storeId);
    if (!entitlements.features.includes(feature)) {
      reply
        .code(402)
        .send({ error: "Este recurso não está disponível no seu plano.", code: "FEATURE_LOCKED", feature, details: { feature } });
    }
  };
}

// ── Limite do plano sem corrida (SEC-21 / ST-35) ──────────────────────────────────────────
// Contar e criar precisa acontecer numa janela exclusiva por loja+limite; senão 8 pedidos paralelos
// passam todos pela contagem. Duas camadas:
//  1) fila em memória por (loja, limite): quem espera NÃO ocupa conexão do banco (evita esgotar o pool);
//  2) `pg_advisory_xact_lock` numa transação mantida aberta até a resposta terminar: vale entre várias
//     instâncias da API.
// A janela só fecha quando a resposta acaba (a criação já foi gravada), e uma transação-guarda com
// prazo (LIMIT_LOCK_TIMEOUT_MS) solta o lock sozinha se algo travar.
const LIMIT_LOCK_TIMEOUT_MS = 20_000;
const limitQueues = new Map<string, Promise<void>>();

async function enterLimitQueue(key: string): Promise<() => void> {
  const previous = limitQueues.get(key) ?? Promise.resolve();
  let leave!: () => void;
  const mine = new Promise<void>((resolve) => (leave = resolve));
  const tail = previous.then(() => mine);
  limitQueues.set(key, tail);
  void tail.then(() => {
    if (limitQueues.get(key) === tail) limitQueues.delete(key);
  });
  await previous;
  return leave;
}

function holdDbLimitLock(key: string): Promise<() => void> {
  return new Promise((resolveLock, rejectLock) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    prisma
      .$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
          resolveLock(() => release());
          await held;
        },
        { timeout: LIMIT_LOCK_TIMEOUT_MS, maxWait: 10_000 },
      )
      .catch(rejectLock); // depois de resolveLock vira no-op (ex.: prazo estourou e o lock já caiu)
  });
}

async function acquireLimitWindow(storeId: string, limit: LimitKey): Promise<() => void> {
  const key = `limit:${storeId}:${limit}`;
  const leaveQueue = await enterLimitQueue(key);
  try {
    const releaseDb = await holdDbLimitLock(key);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      releaseDb();
      leaveQueue();
    };
  } catch (error) {
    leaveQueue();
    throw error;
  }
}

/**
 * preHandler de limite do plano (maxUsers, maxPrinters): `countCurrent` devolve quantos já existem
 * (só os ativos). Ao atingir o máximo → 402 LIMIT_REACHED. Sem limite (`null`) nunca bloqueia.
 * Contagem e criação são serializadas por loja+limite (ver acima): o preHandler só devolve o
 * controle com a janela aberta e a fecha quando a resposta termina.
 */
export function requireLimit(limit: LimitKey, countCurrent: (request: FastifyRequest) => Promise<number>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { storeId } = request.user;
    const max = (await getRequestEntitlements(request, storeId)).limits[limit];
    if (max === null) return;

    const release = await acquireLimitWindow(storeId, limit);
    let current: number;
    try {
      current = await countCurrent(request);
    } catch (error) {
      release();
      throw error;
    }
    if (current >= max) {
      release();
      return reply
        .code(402)
        .send({ error: "Você atingiu o limite do seu plano.", code: "LIMIT_REACHED", details: { limit, max, current } });
    }
    // Janela aberta até o fim da resposta (sucesso, erro ou conexão derrubada).
    reply.raw.once("close", release);
    return undefined;
  };
}

export function newTrialEndsAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + trialDays() * DAY_MS);
}
