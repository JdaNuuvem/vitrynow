"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isRouteActive, PANEL_ROUTES } from "@/core/navigation/panelNavigation";
import { Icon } from "@/shared/icons/Icon";
import { useSearch } from "@/features/busca/SearchProvider";
import { usePlanStatus } from "@/features/planos/usePlanStatus";
import { routeBadge } from "../routeBadges";

export function SidebarNav({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const { openSearch } = useSearch();
  const plan = usePlanStatus();

  return (
    <ul className="shell-nav">
      <li>
        <button type="button" className="shell-nav__item shell-nav__item--search" onClick={openSearch} aria-label="Buscar no painel" title="Buscar">
          <Icon name="search" size={18} />
          <span className="shell-nav__label">Buscar</span>
          <kbd className="shell-nav__shortcut">Ctrl K</kbd>
        </button>
      </li>
      {PANEL_ROUTES.map((route) => {
        const active = isRouteActive(route, pathname);
        const badge = routeBadge(route.id, plan);
        return (
          <li key={route.id}>
            <Link
              href={route.href}
              className={`shell-nav__item${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={route.tooltip}
              onClick={onNavigate}
            >
              <Icon name={route.icon} size={18} />
              <span className="shell-nav__label">{route.label}</span>
              {badge && <span className="shell-nav__badge">{badge}</span>}
              {active && <Icon name="chevronRight" size={14} className="shell-nav__arrow" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
