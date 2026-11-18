"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AuthGateway } from "../gateways/AuthGateway";

// As telas de login/recuperação ficam fora do painel (sem sessão), então não têm o
// PanelServicesProvider — só precisam do AuthGateway.
const AuthServicesContext = createContext<AuthGateway | null>(null);

export function AuthServicesProvider({ auth, children }: { auth: AuthGateway; children: ReactNode }) {
  return <AuthServicesContext.Provider value={auth}>{children}</AuthServicesContext.Provider>;
}

export function useAuthGateway(): AuthGateway {
  const auth = useContext(AuthServicesContext);
  if (!auth) throw new Error("useAuthGateway precisa estar dentro de <AuthServicesProvider>");
  return auth;
}
