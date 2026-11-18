"use client";

import Link from "next/link";
import { describePlanBanner } from "./planBanner";
import { usePlanStatus } from "./usePlanStatus";
import "./planos.css";

export function PlanStatusBanner({ variant, plansHref }: { variant: "desktop" | "mobile"; plansHref: string }) {
  const plan = usePlanStatus();
  if (!plan || plan.state === "active") return null;

  const { tone, message } = describePlanBanner(plan);
  return (
    <div className={`plan-banner plan-banner--${tone} plan-banner--${variant}`}>
      <p>{message}</p>
      <Link href={plansHref}>Ver planos</Link>
    </div>
  );
}
