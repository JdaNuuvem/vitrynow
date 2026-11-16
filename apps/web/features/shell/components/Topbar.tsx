"use client";

import { usePathname } from "next/navigation";
import { isRouteActive, PANEL_ROUTES } from "@/core/navigation/panelNavigation";

export function Topbar() {
  const pathname = usePathname();
  const current = PANEL_ROUTES.find((route) => isRouteActive(route, pathname));
  return (
    <header className="shell-topbar">
      <p>{current?.label ?? "Painel"}</p>
    </header>
  );
}
