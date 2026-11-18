"use client";

import { useEffect, useState } from "react";
import type { PanelRole } from "@/core/gateways/AuthGateway";
import { usePanelServices } from "@/core/services/PanelServices";

// Papel de quem está no painel, lido de GET /auth/me. `null` enquanto carrega ou se a leitura falhar: quem usa
// trata "não sei" como "não é o dono" (esconde a ação), nunca como permissão. A API continua recusando por conta própria.
export function useCurrentRole(): PanelRole | null {
  const { auth } = usePanelServices();
  const [role, setRole] = useState<PanelRole | null>(null);

  useEffect(() => {
    let active = true;
    auth.me().then((result) => {
      if (active && result.ok) setRole(result.data.user.role);
    });
    return () => {
      active = false;
    };
  }, [auth]);

  return role;
}
