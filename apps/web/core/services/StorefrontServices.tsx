"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { StorefrontGateway } from "../gateways/StorefrontGateway";

// Serviços da loja pública. Contexto separado do PanelServices: a loja não tem login e não
// deve enxergar gateways do painel.
export type StorefrontServices = {
  storefront: StorefrontGateway;
};

const StorefrontServicesContext = createContext<StorefrontServices | null>(null);

export function StorefrontServicesProvider({ services, children }: { services: StorefrontServices; children: ReactNode }) {
  return <StorefrontServicesContext.Provider value={services}>{children}</StorefrontServicesContext.Provider>;
}

export function useStorefrontServices(): StorefrontServices {
  const services = useContext(StorefrontServicesContext);
  if (!services) throw new Error("useStorefrontServices precisa estar dentro de <StorefrontServicesProvider>");
  return services;
}
