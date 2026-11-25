"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatCents, moneyOrHidden } from "@/shared/format/money";
import { PlanStatusBanner } from "@/features/planos/PlanStatusBanner";
import { useStore } from "@/features/shell/StoreProvider";
import { Shine } from "@/shared/ui/Shine";
import { Icon } from "@/shared/icons/Icon";
import { CurrentOrdersCard } from "./components/CurrentOrdersCard";
import { StoreOperations } from "./components/StoreOperations";
import { OrderTypesCard } from "./components/OrderTypesCard";
import { PromoCard } from "./components/PromoCard";
import { RevenueCard } from "./components/RevenueCard";
import { StatCard } from "./components/StatCard";
import { TopProductsCard } from "./components/TopProductsCard";
import { useHiddenValues } from "./hooks/useHiddenValues";
import { useInicioData } from "./hooks/useInicioData";
import { buildMonthSeries, buildPeriodMetrics, monthRange, weekRange } from "./services/inicioMetrics";
import { visiblePromoCards } from "./promoCards";
import "./inicio.css";
import { useStoreTimezone } from "@/features/shell/useStoreTimezone";
import { formatInStoreTimezone } from "@/shared/format/storeTime";
import { activeStoreTimezone } from "@/shared/format/storeTime";

type Update = { error: string | null; updatedAt: Date | null; retry: () => void };
function UpdateNotice({ label, source }: { label: string; source: Update }) {
  if (!source.error) return null;
  return (
    <div className="inicio-notice" role="status">
      <span><strong>{label}.</strong> {source.error}{source.updatedAt && ` Última atualização às ${formatInStoreTimezone(source.updatedAt, activeStoreTimezone(), { hour: "2-digit", minute: "2-digit" })}.`}</span>
      <button type="button" onClick={source.retry}>Tentar novamente</button>
    </div>
  );
}

function valueText(cents: number | undefined, hidden: boolean) {
  if (cents === undefined) return "—";
  return moneyOrHidden(cents, hidden);
}

export function InicioPage() {
  const { month, week, open, waiting, legacyOrders } = useInicioData();
  const { hidden, toggle } = useHiddenValues();
  const store = useStore();
  const timeZone = useStoreTimezone();
  const calendar = { format: (date: Date) => formatInStoreTimezone(date, timeZone, { day: "numeric", month: "short", year: "numeric" }) };
  const dateRange = { format: (date: Date) => formatInStoreTimezone(date, timeZone, { day: "numeric", month: "short" }) };
  const completeOrders = legacyOrders.data && !legacyOrders.error && !legacyOrders.data.openCapped && !legacyOrders.data.openHidden
    ? legacyOrders.data.orders : null;
  const monthly = useMemo(() => month.data && month.updatedAt
    ? buildPeriodMetrics(month.data, monthRange(month.updatedAt, timeZone), completeOrders, timeZone) : null, [month.data, month.updatedAt, completeOrders, timeZone]);
  const weekly = useMemo(() => week.data && week.updatedAt
    ? buildPeriodMetrics(week.data, weekRange(week.updatedAt, timeZone), completeOrders, timeZone) : null, [week.data, week.updatedAt, completeOrders, timeZone]);
  const series = useMemo(() => monthly && month.updatedAt ? buildMonthSeries(monthly.byDay, month.updatedAt, timeZone) : [], [monthly, month.updatedAt, timeZone]);
  const hasMoney = monthly?.revenueCents !== undefined;
  const hideOrderValues = hidden || !hasMoney;
  const monthMissing = month.error ? "—" : null;
  const updatedAt = open.updatedAt ?? waiting.updatedAt ?? month.updatedAt;
  const monthLabel = month.updatedAt ? `1º a ${dateRange.format(month.updatedAt)}` : "Mês atual";
  return (
    <main className="inicio">
      <PlanStatusBanner variant="desktop" plansHref="/dashboard/planos" />
      <PlanStatusBanner variant="mobile" plansHref="/dashboard/planos" />
      <div className="inicio__layout">
        <header className="inicio__heading">
          <div><h1>Visão geral</h1>{store && <p className="inicio__store">{store.name}</p>}</div>
          {updatedAt && <time dateTime={updatedAt.toISOString()}>
            <Icon name="clock" size={16} /><span>{calendar.format(updatedAt)}</span>
          </time>}
        </header>
        <Link className="inicio-primary" href="/dashboard/pedidos/novo"><span aria-hidden="true">+</span>Novo pedido</Link>
        <div className="inicio__main">
          <div className="inicio__stats">
            {monthly && !hasMoney ? (
              <StatCard title="Vendas aceitas" value={String(monthly.orderCount)} period={monthLabel} icon="orders" />
            ) : (
              <StatCard title="Faturamento" value={monthly ? valueText(monthly.revenueCents, hidden) : monthMissing} period={monthLabel} icon="payments" visibility={hasMoney ? { hidden, toggle } : undefined} />
            )}
            <StatCard title="Em andamento" value={open.data ? String(open.data.total) : open.error ? "—" : null} period="Em aberto agora" icon="clock" />
            <StatCard title="Pix pendentes" value={waiting.data ? String(waiting.data.count) : waiting.error ? "—" : null} period={waiting.data?.count === 200 ? "Limite da consulta" : "Aguardando pagamento"} icon="payments" />
            <StatCard title={monthly && !hasMoney ? "Clientes do mês" : "Vendas aceitas"} value={monthly ? String(hasMoney ? monthly.orderCount : month.data?.customerCount ?? 0) : monthMissing} period={monthLabel} icon="check" />
          </div>
          <UpdateNotice label="Resumo do mês" source={month} />
          <UpdateNotice label="Pedidos em andamento" source={open} />
          <UpdateNotice label="Pix pendentes" source={waiting} />
          <div className="inicio__queues">
            <CurrentOrdersCard title="Pedidos em andamento" data={open.data} error={open.error} hidden={hideOrderValues} />
            <CurrentOrdersCard title="Aguardando pagamento" waiting data={waiting.data} error={waiting.error} hidden={hideOrderValues} />
          </div>
        </div>
        <StoreOperations />
      </div>
      <div className="inicio__secondary">
        {monthly && month.data ? (
          <>
            <RevenueCard metrics={{ ...monthly, monthSeries: series }} hidden={hidden} onToggleHidden={toggle} teamHref="/dashboard/equipe" />
            <TopProductsCard products={month.data.topProducts} hidden={hidden} reportsHref="/dashboard/relatorios" />
            <OrderTypesCard orderTypes={monthly.orderTypes} />
          </>
        ) : !month.error && <div className="inicio-card" aria-label="Carregando resumo do mês" aria-busy="true"><Shine height={100} /></div>}
        <section className="inicio-card inicio-summary">
          <h2>Resumo de vendas</h2>
          <dl>
            <div><dt>Vendas nos últimos 7 dias</dt><dd>{weekly?.orderCount ?? "—"}</dd></div>
            {weekly?.revenueCents !== undefined && <div><dt>Faturamento em 7 dias</dt><dd>{valueText(weekly.revenueCents, hidden)}</dd></div>}
            <div><dt>Clientes no mês</dt><dd>{month.data?.customerCount ?? "—"}</dd></div>
            {monthly?.averageTicketCents !== undefined && <div><dt>Ticket médio no mês</dt><dd>{valueText(monthly.averageTicketCents, hidden)}</dd></div>}
          </dl>
          <UpdateNotice label="Últimos 7 dias" source={week} />
        </section>
        {visiblePromoCards().map((config) => <PromoCard key={config.id} config={config} />)}
      </div>
    </main>
  );
}
