import type { PlanStatus } from "@/core/domain/store";

export type PlanBannerView = {
  tone: "info" | "warning" | "error";
  message: string;
};

export function describePlanBanner(plan: PlanStatus): PlanBannerView {
  if (plan.state === "expired") return { tone: "error", message: "Seu teste grátis terminou" };
  const unit = plan.daysLeft === 1 ? "dia" : "dias";
  return {
    tone: plan.state === "warning" ? "warning" : "info",
    message: `Seu teste grátis acaba em ${plan.daysLeft} ${unit}`,
  };
}
