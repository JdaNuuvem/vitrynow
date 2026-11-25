"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isRouteActive, PANEL_ROUTES } from "@/core/navigation/panelNavigation";
import { Icon } from "@/shared/icons/Icon";

const TAB_IDS = ["inicio", "pedidos", "catalogo"] as const;

export function Bottombar({ onOpenMenu, onNavigate, menuOpen = false }: { onOpenMenu: () => void; onNavigate: () => void; menuOpen?: boolean }) {
  const pathname = usePathname();
  const tabs = TAB_IDS.map((id) => PANEL_ROUTES.find((route) => route.id === id)).filter((route) => route !== undefined);

  return (
    <nav className="shell-bottombar" aria-label="Navegação rápida">
      {tabs.map((route) => (
        <Link key={route.id} href={route.href} className={isRouteActive(route, pathname) ? "is-active" : undefined} aria-current={isRouteActive(route, pathname) ? "page" : undefined} onClick={onNavigate}>
          <Icon name={route.icon} size={22} />
          {route.label}
        </Link>
      ))}
      <button type="button" onClick={onOpenMenu} aria-expanded={menuOpen} aria-controls="shell-sidebar">
        <Icon name="menu" size={22} />
        Mais
      </button>
    </nav>
  );
}
