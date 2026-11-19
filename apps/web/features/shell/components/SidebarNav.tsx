"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isRouteActive, PANEL_ROUTES, type PanelRoute } from "@/core/navigation/panelNavigation";
import { Icon } from "@/shared/icons/Icon";
import { useSearch } from "@/features/busca/SearchProvider";
import { usePlanStatus } from "@/features/planos/usePlanStatus";
import { routeBadge } from "../routeBadges";

const operations = new Set(["inicio", "pedidos", "mesas", "caixa", "impressoras"]);
const storeSettings = new Set(["conta", "aparencia", "horarios", "zonas", "pagamentos", "planos", "primeiros-passos"]);

export function SidebarNav({ onNavigate, routes = PANEL_ROUTES }: { onNavigate: () => void; routes?: readonly PanelRoute[] }) {
  const pathname = usePathname();
  const { openSearch } = useSearch();
  const plan = usePlanStatus();

  const groups = [
    { title: "Operação", routes: routes.filter((route) => operations.has(route.id)) },
    { title: "Gestão", routes: routes.filter((route) => !operations.has(route.id) && !storeSettings.has(route.id)) },
    { title: "Configurações", routes: routes.filter((route) => storeSettings.has(route.id)) },
  ];

  return (
    <nav aria-label="Todas as seções" className="shell-nav-stack">
      <button type="button" className="shell-nav__item shell-nav__item--search" onClick={() => { onNavigate(); openSearch(); }} aria-label="Buscar no painel" title="Buscar">
        <Icon name="search" size={18} />
        <span className="shell-nav__label">Buscar</span>
        <kbd className="shell-nav__shortcut">Ctrl K</kbd>
      </button>
      {groups.map(({ title, routes }) => <div className="shell-nav-group" key={title}>
        <h2>{title}</h2>
        <ul className="shell-nav">{routes.map((route) => {
        const active = isRouteActive(route, pathname);
        const badge = routeBadge(route.id, plan);
        return (
          <li key={route.id}>
            <Link
              href={route.href}
              className={`shell-nav__item${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={route.tooltip}
              // Com o menu recolhido o texto some (display:none); o nome acessível precisa continuar.
              aria-label={badge ? `${route.label}, ${badge}` : route.label}
              onClick={onNavigate}
            >
              <Icon name={route.icon} size={18} />
              <span className="shell-nav__label">{route.label}</span>
              {badge && <span className="shell-nav__badge">{badge}</span>}
              {active && <Icon name="chevronRight" size={14} className="shell-nav__arrow" />}
            </Link>
          </li>
        );
        })}</ul>
      </div>)}
    </nav>
  );
}
