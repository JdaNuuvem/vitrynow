"use client";

import { usePathname } from "next/navigation";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { PanelServicesProvider } from "@/core/services/PanelServices";
import { createHttpPanelServices } from "@/core/services/createHttpPanelServices";
import { HelpProvider } from "@/features/ajuda/HelpWidget";
import { SearchProvider } from "@/features/busca/SearchProvider";
import { FeatureUpgradeProvider } from "@/features/planos/FeatureUpgradeContext";
import { PlanStatusProvider } from "@/features/planos/usePlanStatus";
import { SecurityConfirmProvider } from "@/features/seguranca/SecurityConfirmProvider";
import { Bottombar } from "./components/Bottombar";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { useSidebarState } from "./hooks/useSidebarState";
import { StoreProvider, useStore } from "./StoreProvider";
import "@/shared/styles/panel-tokens.css";
import "./shell.css";

const PLANS_HREF = "/dashboard/planos";

function ThemeRoot({ children }: { children: ReactNode }) {
  const store = useStore();
  const pathname = usePathname();
  const themeStyle = store?.primaryColor ? ({ "--color-primary": store.primaryColor } as CSSProperties) : undefined;
  const isHome = pathname === "/dashboard";

  return (
    <div className={`panel-root${isHome ? " panel-root--home" : ""}`} style={themeStyle}>
      {children}
    </div>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const { collapsed, toggleCollapsed, mobileOpen, openMobile, closeMobile } = useSidebarState();

  return (
    <>
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onToggle={toggleCollapsed} onNavigate={closeMobile} />
      {/* Com o menu aberto no celular, o conteúdo atrás fica inerte: nem Tab nem leitor de tela chegam nele. */}
      <div className={`shell-content${collapsed ? " is-sidebar-collapsed" : ""}`} {...(mobileOpen ? ({ inert: "" } as Record<string, string>) : {})}>
        <Topbar />
        {children}
      </div>
      <Bottombar onOpenMenu={openMobile} onNavigate={closeMobile} menuOpen={mobileOpen} />
    </>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const services = useMemo(() => createHttpPanelServices(), []);

  return (
    <PanelServicesProvider services={services}>
      <StoreProvider>
        <ThemeRoot>
          <PlanStatusProvider>
            <FeatureUpgradeProvider plansHref={PLANS_HREF}>
              <SearchProvider>
                <HelpProvider>
                  <SecurityConfirmProvider>
                    <ShellLayout>{children}</ShellLayout>
                  </SecurityConfirmProvider>
                </HelpProvider>
              </SearchProvider>
            </FeatureUpgradeProvider>
          </PlanStatusProvider>
        </ThemeRoot>
      </StoreProvider>
    </PanelServicesProvider>
  );
}
