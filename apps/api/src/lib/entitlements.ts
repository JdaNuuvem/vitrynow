import type { Plan, Subscription } from "@meucardapio/db";
import { isFeature, isReleased, type Feature } from "./features";

// Núcleo PURO de entitlements (ADR-0003 §2): fase da assinatura, recursos, limites e o que cada
// fase permite. Sem banco e sem relógio próprio — recebe `now` — para ser testado por tabela.
// A leitura do banco e os preHandlers ficam em lib/subscription.ts.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dias em Consulta (somente leitura) depois do fim do teste ou do vencimento (D3). */
export const READ_ONLY_DAYS = 7;

export type Phase = "TRIAL" | "ACTIVE" | "READ_ONLY" | "SUSPENDED";

/** `null` = sem limite. */
export type PlanLimits = { maxUsers: number | null; maxPrinters: number | null };
export type LimitKey = keyof PlanLimits;

// O que o BASICO permite (D2). É também o que vale no teste (CA-B10-03) e o fallback quando a
// linha do plano no banco não traz o limite.
export const BASICO_LIMITS: PlanLimits = { maxUsers: 1, maxPrinters: 1 };

export type StoreFace = "full" | "notice" | "unavailable";

/** Matriz de ADR-0003 §2.3 como dado. A UI espelha; o servidor decide. */
export type Access = {
  /** Cardápio público: completo, visível com faixa "não está recebendo pedidos", ou página neutra. */
  storefront: StoreFace;
  /** Cardápio/QR de mesa aceitam pedido novo (409 `SUBSCRIPTION_INACTIVE` quando false). */
  publicOrders: boolean;
  panelRead: boolean;
  panelWrite: boolean;
  /**
   * Em Consulta, encerrar o que já foi recebido (concluir/cancelar/estornar, receber mesa, fechar
   * caixa) — decisão do Claudio, RN-A-01. Reversível: muda só esta linha.
   */
  canFinishInProgress: boolean;
  /** Print-client: `queue` imprime o que já estava na fila; `none` recusa (402). */
  printing: "full" | "queue" | "none";
};

const ACCESS: Record<Phase, Access> = {
  TRIAL: { storefront: "full", publicOrders: true, panelRead: true, panelWrite: true, canFinishInProgress: true, printing: "full" },
  ACTIVE: { storefront: "full", publicOrders: true, panelRead: true, panelWrite: true, canFinishInProgress: true, printing: "full" },
  READ_ONLY: { storefront: "notice", publicOrders: false, panelRead: true, panelWrite: false, canFinishInProgress: true, printing: "queue" },
  SUSPENDED: { storefront: "unavailable", publicOrders: false, panelRead: false, panelWrite: false, canFinishInProgress: false, printing: "none" },
};

export function accessFor(phase: Phase): Access {
  return { ...ACCESS[phase] };
}

export type Entitlements = {
  phase: Phase;
  /** Fim da Consulta (início da Suspensão); `null` em TRIAL/ACTIVE. */
  readOnlyEndsAt: string | null;
  features: Feature[];
  limits: PlanLimits;
  access: Access;
};

type SubscriptionLike = Pick<Subscription, "status" | "trialEndsAt" | "currentPeriodEnd">;
type PlanLike = Pick<Plan, "features"> & { limits?: unknown };

/** Recursos do plano que já foram entregues; chave desconhecida ou não entregue é ignorada (RN-B10-08). */
export function planFeatures(plan: PlanLike | null): Feature[] {
  return (plan?.features ?? []).filter((key): key is Feature => isFeature(key) && isReleased(key));
}

function limitValue(raw: unknown, fallback: number | null): number | null {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  return fallback;
}

/** Limites do plano; ausente ou inválido cai no padrão do BASICO (o mais restritivo). */
export function planLimits(plan: PlanLike | null): PlanLimits {
  const raw = plan?.limits && typeof plan.limits === "object" && !Array.isArray(plan.limits) ? (plan.limits as Record<string, unknown>) : {};
  return {
    maxUsers: "maxUsers" in raw ? limitValue(raw.maxUsers, BASICO_LIMITS.maxUsers) : BASICO_LIMITS.maxUsers,
    maxPrinters: "maxPrinters" in raw ? limitValue(raw.maxPrinters, BASICO_LIMITS.maxPrinters) : BASICO_LIMITS.maxPrinters,
  };
}

/**
 * Fase da assinatura em `now` (ADR-0003 §2.2):
 * TRIAL → (venceu) READ_ONLY por 7 dias → SUSPENDED; ACTIVE/CANCELED com período em dia → ACTIVE;
 * período vencido segue a mesma regra do teste (assunção A4 do quadro, aguarda o Claudio).
 */
export function phaseOf(subscription: SubscriptionLike, now: Date): { phase: Phase; readOnlyEndsAt: Date | null } {
  const periodEnd = subscription.currentPeriodEnd;
  if (subscription.status === "TRIAL") {
    if (subscription.trialEndsAt > now) return { phase: "TRIAL", readOnlyEndsAt: null };
  } else if (periodEnd !== null && periodEnd > now) {
    return { phase: "ACTIVE", readOnlyEndsAt: null };
  }

  const lapsedAt = subscription.status === "TRIAL" ? subscription.trialEndsAt : (periodEnd ?? subscription.trialEndsAt);
  const readOnlyEndsAt = new Date(lapsedAt.getTime() + READ_ONLY_DAYS * DAY_MS);
  return { phase: now < readOnlyEndsAt ? "READ_ONLY" : "SUSPENDED", readOnlyEndsAt };
}

/**
 * Entitlements em `now`. `basicPlan` é o plano BASICO (o teste vale exatamente o que ele tem,
 * D2/CA-B10-03); `subscription.plan` vale enquanto a assinatura está em dia. Em Consulta e
 * Suspensão nenhum recurso de plano é liberado (a leitura continua pelo `access`).
 */
export function resolveEntitlements(
  subscription: SubscriptionLike & { plan: PlanLike | null },
  basicPlan: PlanLike | null,
  now: Date,
): Entitlements {
  const { phase, readOnlyEndsAt } = phaseOf(subscription, now);
  const effectivePlan = phase === "TRIAL" ? basicPlan : (subscription.plan ?? basicPlan);
  return {
    phase,
    readOnlyEndsAt: readOnlyEndsAt?.toISOString() ?? null,
    features: phase === "TRIAL" || phase === "ACTIVE" ? planFeatures(effectivePlan) : [],
    limits: planLimits(effectivePlan),
    access: accessFor(phase),
  };
}
