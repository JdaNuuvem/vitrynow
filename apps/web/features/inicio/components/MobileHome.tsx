"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { greetingFor } from "@/shared/format/greeting";
import { Icon, type IconName } from "@/shared/icons/Icon";
import { PlanStatusBanner } from "@/features/planos/PlanStatusBanner";
import { OnboardingWidget } from "@/features/shell/components/OnboardingWidget";
import { StoreHeader } from "@/features/shell/components/StoreHeader";
import { StoreHoursCard } from "@/features/shell/components/StoreHoursCard";
import { computeOnboarding } from "@/features/shell/onboarding";
import { useStore } from "@/features/shell/StoreProvider";

const QUICK_LINKS: { label: string; href: string; icon: IconName }[] = [
  { label: "Loja", href: "/dashboard/conta", icon: "store" },
  { label: "Plano", href: "/dashboard/planos", icon: "plan" },
  { label: "Relatórios", href: "/dashboard/relatorios", icon: "reports" },
  { label: "Impressoras", href: "/dashboard/impressoras", icon: "printer" },
  { label: "Horários", href: "/dashboard/conta", icon: "clock" },
  { label: "Entrega", href: "/dashboard/entregadores", icon: "delivery" },
  { label: "Caixa", href: "/dashboard/caixa", icon: "wallet" },
  { label: "Cupons", href: "/dashboard/cupons", icon: "coupons" },
];

export function MobileHome() {
  const store = useStore();
  const [greeting, setGreeting] = useState("");

  useEffect(() => setGreeting(greetingFor(new Date())), []);

  return (
    <div className="inicio-mobile">
      <h3 className="inicio-mobile__title">{greeting}</h3>
      <PlanStatusBanner variant="mobile" plansHref="/dashboard/planos" />
      {store && (
        <div className="inicio-mobile__cards">
          <div className="inicio-mobile__options">
            <StoreHeader store={store} collapsed={false} />
            <StoreHoursCard openingHours={store.openingHours} settingsHref="/dashboard/conta" acceptingOrders={store.acceptingOrders} />
            <div className="inicio-mobile__links">
              {QUICK_LINKS.map((link) => (
                <Link key={link.label} href={link.href}>
                  <div>
                    <Icon name={link.icon} size={20} />
                  </div>
                  <p>{link.label}</p>
                </Link>
              ))}
            </div>
          </div>
          <OnboardingWidget progress={computeOnboarding(store)} href="/dashboard/conta" />
        </div>
      )}
    </div>
  );
}
