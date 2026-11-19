"use client";

import { useRef, type RefObject } from "react";
import type { PanelRoute } from "@/core/navigation/panelNavigation";
import { ThemeControls } from "@/shared/design/ThemeControls";
import { Icon } from "@/shared/icons/Icon";
import { CaixaWidget } from "@/features/caixa/CaixaWidget";
import { useMobileMenuFocus } from "../hooks/useMobileMenuFocus";
import { useStore } from "../StoreProvider";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarNav } from "./SidebarNav";
import { StoreHeader } from "./StoreHeader";
import { StoreHoursCard } from "./StoreHoursCard";

const SETTINGS_HREF = "/dashboard/conta/horarios";
const REPORTS_HREF = "/dashboard/relatorios";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement>;
  routes: readonly PanelRoute[];
};

export function Sidebar({ open, onClose, triggerRef, routes }: SidebarProps) {
  const store = useStore();
  const asideRef = useRef<HTMLElement>(null);
  useMobileMenuFocus(open, asideRef, onClose, triggerRef);

  return (
    <>
      {open && <div className="shell-scrim" aria-hidden="true" onClick={onClose} />}
      <aside hidden={!open} ref={asideRef} id="shell-sidebar" tabIndex={-1} className="shell-sidebar" aria-label="Menu do painel">
        <div className="shell-sidebar__heading">
          <strong>Menu do painel</strong>
          <div className="shell-sidebar__preferences">
            <ThemeControls compact />
            <button type="button" className="shell-tool" onClick={onClose} aria-label="Fechar menu">
              <Icon name="close" size={20} />
            </button>
          </div>
        </div>
        {store && <StoreHeader store={store} collapsed={false} />}
        <div className="shell-sidebar__scroll">
          <SidebarNav onNavigate={onClose} routes={routes} />
          {open && store && (
            <>
              <StoreHoursCard openingHours={store.openingHours} settingsHref={SETTINGS_HREF} acceptingOrders={store.acceptingOrders} />
              <CaixaWidget reportsHref={REPORTS_HREF} />
            </>
          )}
          <SidebarFooter onNavigate={onClose} />
        </div>
      </aside>
    </>
  );
}
