"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanelServicesProvider } from "@/core/services/PanelServices";
import { createHttpPanelServices } from "@/core/services/createHttpPanelServices";
import { HelpProvider } from "@/features/ajuda/HelpWidget";
import { SearchProvider } from "@/features/busca/SearchProvider";
import { FeatureUpgradeProvider } from "@/features/planos/FeatureUpgradeContext";
import { PlanStatusProvider } from "@/features/planos/usePlanStatus";
import { SecurityConfirmProvider } from "@/features/seguranca/SecurityConfirmProvider";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { PANEL_ROUTES, PRIVACY_ROUTE, type PanelRoute } from "@/core/navigation/panelNavigation";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { Bottombar } from "./components/Bottombar";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { StoreProvider } from "./StoreProvider";
import "@/shared/styles/panel-tokens.css";
import "./shell.css";

const PLANS_HREF = "/dashboard/planos";
const ownerRoutes = [...PANEL_ROUTES, PRIVACY_ROUTE];
const capabilities = new FetchHttpClient();

function ShellLayout({ children, routes }: { children: ReactNode; routes: readonly PanelRoute[] }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const openMenu = () => {
    menuTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenuOpen(true);
  };
  const closeMenu = () => setMenuOpen(false);
  const contentRef = useCallback((element: HTMLDivElement | null) => {
    element?.toggleAttribute("inert", menuOpen);
  }, [menuOpen]);
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <>
      <Sidebar open={menuOpen} onClose={closeMenu} triggerRef={menuTrigger} routes={routes} />
      <div className="shell-content" ref={contentRef}>
        <Topbar onOpenMenu={openMenu} menuOpen={menuOpen} />
        {children}
        <Bottombar onOpenMenu={openMenu} onNavigate={closeMenu} menuOpen={menuOpen} />
      </div>
    </>
  );
}

function PanelNavigation({ children }: { children: ReactNode }) {
  const role = useCurrentRole();
  const [privacyAvailable, setPrivacyAvailable] = useState(false);
  useEffect(() => {
    if (role !== "OWNER") return;
    let active = true;
    capabilities.get("/api/privacy/status").then((result) => { if (active) setPrivacyAvailable(result.ok); });
    return () => { active = false; };
  }, [role]);
  const routes = role === "OWNER" && privacyAvailable ? ownerRoutes : PANEL_ROUTES;
  return (
    <SearchProvider routes={routes}>
      <HelpProvider>
        <SecurityConfirmProvider>
          <ShellLayout routes={routes}>{children}</ShellLayout>
        </SecurityConfirmProvider>
      </HelpProvider>
    </SearchProvider>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const services = useMemo(() => createHttpPanelServices(), []);

  return (
    <PanelServicesProvider services={services}>
      <StoreProvider>
        <div className="panel-root panel-root--dashboard">
          <PlanStatusProvider>
            <FeatureUpgradeProvider plansHref={PLANS_HREF}>
              <PanelNavigation>{children}</PanelNavigation>
            </FeatureUpgradeProvider>
          </PlanStatusProvider>
        </div>
      </StoreProvider>
    </PanelServicesProvider>
  );
}
