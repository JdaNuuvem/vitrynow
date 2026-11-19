"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isRouteActive, PANEL_ROUTES } from "@/core/navigation/panelNavigation";
import { useHelp } from "@/features/ajuda/HelpWidget";
import { useSearch } from "@/features/busca/SearchProvider";
import { Icon } from "@/shared/icons/Icon";
import { VitryBrand } from "@/shared/ui/VitryBrand";
import { useStore } from "../StoreProvider";
import { StoreAvatar } from "./StoreHeader";

const PRIMARY_ROUTES = PANEL_ROUTES.filter((route) => ["inicio", "pedidos", "mesas", "catalogo", "caixa"].includes(route.id));
const historyHref = "/dashboard/pedidos/historico";

export function Topbar({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  const pathname = usePathname();
  const store = useStore();
  const { openSearch } = useSearch();
  const { openHelp } = useHelp();

  return (
    <header className="shell-topbar">
      <div className="shell-topbar__inner">
        <Link className="shell-brand" href="/dashboard" aria-label="VitryNow, início do painel">
          <VitryBrand />
        </Link>
        <nav className="shell-tabs" aria-label="Seções principais">
          {PRIMARY_ROUTES.map((route) => (
            <Link key={route.id} href={route.href}
              aria-current={isRouteActive(route, pathname) && pathname !== historyHref ? "page" : undefined}>
              <Icon name={route.icon} size={18} />
              {route.label}
            </Link>
          ))}
          <Link href={historyHref} aria-current={pathname === historyHref ? "page" : undefined}>
            <Icon name="clock" size={18} /> Histórico
          </Link>
        </nav>
        <div className="shell-tools">
          <button type="button" className="shell-tool shell-tool--search" onClick={openSearch} aria-label="Buscar no painel" title="Buscar (Ctrl K)">
            <Icon name="search" size={20} />
          </button>
          <button type="button" className="shell-tool" onClick={() => openHelp("avisos")} aria-label="Abrir avisos" title="Avisos">
            <Icon name="bell" size={20} />
          </button>
          <button type="button" className="shell-account" onClick={onOpenMenu} aria-expanded={menuOpen} aria-controls="shell-sidebar" aria-label="Abrir menu completo do painel">
            {store ? <StoreAvatar store={store} /> : <Icon name="menu" size={20} />}
            <span>{store?.name || "Menu"}</span>
            <Icon name="chevronDown" size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
