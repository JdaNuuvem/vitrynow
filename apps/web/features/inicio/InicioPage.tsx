"use client";

import { formatCents } from "@/shared/format/money";
import { PlanStatusBanner } from "@/features/planos/PlanStatusBanner";
import { CurrentOrdersCard } from "./components/CurrentOrdersCard";
import { MobileHome } from "./components/MobileHome";
import { OrderTypesCard } from "./components/OrderTypesCard";
import { PromoCard } from "./components/PromoCard";
import { RevenueCard } from "./components/RevenueCard";
import { StatCard } from "./components/StatCard";
import { TopProductsCard } from "./components/TopProductsCard";
import { useHiddenValues } from "./hooks/useHiddenValues";
import { useInicioData } from "./hooks/useInicioData";
import { PROMO_CARDS } from "./promoCards";
import "./inicio.css";

const PLANS_HREF = "/dashboard/planos";
const REPORTS_HREF = "/dashboard/relatorios";
const ORDERS_HREF = "/dashboard/pedidos";
const TEAM_HREF = "/dashboard/equipe";

export function InicioPage() {
  const { metrics, currentOrders } = useInicioData();
  const { hidden, toggle } = useHiddenValues();

  const money = (cents: number | undefined) => (cents === undefined ? null : hidden ? "R$ ••••" : formatCents(cents));

  return (
    <>
      <PlanStatusBanner variant="desktop" plansHref={PLANS_HREF} />
      <div className="inicio">
        <div className="inicio__left">
          <MobileHome />
          <RevenueCard metrics={metrics} hidden={hidden} onToggleHidden={toggle} teamHref={TEAM_HREF} />
          <div className="inicio__stats">
            <StatCard title="Total de pedidos" value={metrics ? String(metrics.orderCount) : null} />
            <StatCard title="Clientes totais" value={metrics ? String(metrics.customerCount) : null} />
            <StatCard title="Ticket médio" value={money(metrics?.averageTicketCents)} />
          </div>
          <TopProductsCard products={metrics?.topProducts ?? null} reportsHref={REPORTS_HREF} />
        </div>
        <div className="inicio__right">
          {PROMO_CARDS.map((config) => (
            <PromoCard key={config.id} config={config} />
          ))}
          <StatCard title="Pedidos - 7 dias" value={metrics ? String(metrics.week.orderCount) : null} />
          <StatCard title="Receita - 7 dias" value={money(metrics?.week.revenueCents)} />
          <OrderTypesCard orderTypes={metrics?.orderTypes ?? null} />
          <CurrentOrdersCard orders={currentOrders} ordersHref={ORDERS_HREF} />
        </div>
      </div>
    </>
  );
}
