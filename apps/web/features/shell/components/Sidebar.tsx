"use client";

import { useRef } from "react";
import { Icon } from "@/shared/icons/Icon";
import { CaixaWidget } from "@/features/caixa/CaixaWidget";
import { useMobileMenuFocus } from "../hooks/useMobileMenuFocus";
import { useHasProducts, useStore } from "../StoreProvider";
import { computeOnboarding } from "../onboarding";
import { OnboardingWidget } from "./OnboardingWidget";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarNav } from "./SidebarNav";
import { StoreHeader } from "./StoreHeader";
import { StoreHoursCard } from "./StoreHoursCard";

const SETTINGS_HREF = "/dashboard/conta";
const REPORTS_HREF = "/dashboard/relatorios";

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onNavigate: () => void;
};

export function Sidebar({ collapsed, mobileOpen, onToggle, onNavigate }: SidebarProps) {
  const store = useStore();
  const hasProducts = useHasProducts();
  const asideRef = useRef<HTMLElement>(null);
  useMobileMenuFocus(mobileOpen, asideRef, onNavigate);
  const classes = ["shell-sidebar", collapsed ? "is-collapsed" : "", mobileOpen ? "is-mobile-open" : ""].filter(Boolean).join(" ");

  return (
    <aside ref={asideRef} id="shell-sidebar" tabIndex={-1} className={classes} aria-label="Menu do painel">
      <button type="button" className="shell-sidebar__toggle" onClick={onToggle} aria-label={collapsed ? "Expandir menu" : "Recolher menu"}>
        <Icon name="sidebarToggle" size={18} />
      </button>

      {store && <StoreHeader store={store} collapsed={collapsed} />}

      <div className="shell-sidebar__scroll">
        {store && !collapsed && (
          <>
            <StoreHoursCard openingHours={store.openingHours} settingsHref={SETTINGS_HREF} acceptingOrders={store.acceptingOrders} />
            {hasProducts !== null && <OnboardingWidget progress={computeOnboarding(store, hasProducts)} href={SETTINGS_HREF} />}
            <CaixaWidget reportsHref={REPORTS_HREF} />
          </>
        )}
        <SidebarNav onNavigate={onNavigate} />
        {!collapsed && <SidebarFooter />}
      </div>
    </aside>
  );
}
