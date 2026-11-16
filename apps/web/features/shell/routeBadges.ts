import type { PlanStatus } from "@/core/domain/store";

// Selo opcional ao lado do item do menu. Cada rota decide o seu; o menu só renderiza o texto.
const BADGES: Record<string, (plan: PlanStatus | null) => string | null> = {
  planos: (plan) => {
    if (!plan || (plan.state !== "info" && plan.state !== "warning")) return null;
    return `Restam ${plan.daysLeft} ${plan.daysLeft === 1 ? "dia" : "dias"}`;
  },
};

export function routeBadge(routeId: string, plan: PlanStatus | null): string | null {
  return BADGES[routeId]?.(plan) ?? null;
}
