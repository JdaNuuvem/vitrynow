"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AuthGateway } from "../gateways/AuthGateway";
import type { CashierGateway } from "../gateways/CashierGateway";
import type { FeedbackGateway } from "../gateways/FeedbackGateway";
import type { DeliverersGateway, OrdersGateway } from "../gateways/OrdersGateway";
import type { PlanGateway } from "../gateways/PlanGateway";
import type { RealtimeGateway } from "../gateways/RealtimeGateway";
import type { ReportsGateway } from "../gateways/ReportsGateway";
import type { StoreGateway } from "../gateways/StoreGateway";
import type { AuditGateway } from "../gateways/AuditGateway";
import type { CatalogGateway } from "../gateways/CatalogGateway";
import type { CouponsGateway } from "../gateways/CouponsGateway";
import type { DeviceTokensGateway } from "../gateways/DeviceTokensGateway";
import type { UsersGateway } from "../gateways/UsersGateway";
import type { MfaGateway } from "../gateways/MfaGateway";
import type { NoticesGateway } from "../gateways/NoticesGateway";
import type { SubscriptionGateway } from "../gateways/SubscriptionGateway";

export type PanelServices = {
  catalog: CatalogGateway;
  coupons: CouponsGateway;
  deviceTokens: DeviceTokensGateway;
  users: UsersGateway;
  audit: AuditGateway;
  auth: AuthGateway;
  store: StoreGateway;
  plan: PlanGateway;
  reports: ReportsGateway;
  cashier: CashierGateway;
  orders: OrdersGateway;
  deliverers: DeliverersGateway;
  feedback: FeedbackGateway;
  realtime: RealtimeGateway;
  subscription: SubscriptionGateway;
  notices: NoticesGateway;
  mfa: MfaGateway;
};

const PanelServicesContext = createContext<PanelServices | null>(null);

export function PanelServicesProvider({ services, children }: { services: PanelServices; children: ReactNode }) {
  return <PanelServicesContext.Provider value={services}>{children}</PanelServicesContext.Provider>;
}

export function usePanelServices(): PanelServices {
  const services = useContext(PanelServicesContext);
  if (!services) throw new Error("usePanelServices precisa estar dentro de <PanelServicesProvider>");
  return services;
}
