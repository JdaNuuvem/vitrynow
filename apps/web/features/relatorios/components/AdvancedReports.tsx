"use client";

import { useEffect, useState } from "react";
import type { AdvancedReport, ReportDelta } from "@/core/domain/reports";
import { usePanelServices } from "@/core/services/PanelServices";
import { useFeatureUpgrade } from "@/features/planos/FeatureUpgradeContext";
import { Button, DataTable, Panel, StateMessage } from "@/shared/design/components";
import { formatCents, moneyOrHidden } from "@/shared/format/money";
import { toReportRange, type DateRange } from "../dateRange";
import { useStoreTimezone } from "@/features/shell/useStoreTimezone";

// API-45 (PRO, só o dono): quando a loja vende (hora e dia da semana), como o período foi contra o anterior,
// quem da equipe aceitou e recebeu, e quantos clientes voltam. Sem o plano, mostra o convite em vez dos dados.

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
type State = { key: string; data?: AdvancedReport; locked?: boolean; error?: string };

export function AdvancedReports({ range, hidden }: { range: DateRange; hidden: boolean }) {
  const { reports } = usePanelServices();
  const timeZone = useStoreTimezone();
  const { openUpgrade } = useFeatureUpgrade();
  const key = `${range.from}/${range.to}`;
  const [state, setState] = useState<State | null>(null);
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue");
  const money = (cents: number) => moneyOrHidden(cents, hidden);

  useEffect(() => {
    const bounds = toReportRange(range, timeZone);
    if (!Number.isFinite(+bounds.from) || !Number.isFinite(+bounds.to) || bounds.from > bounds.to) return;
    let alive = true;
    void reports.getAdvanced(bounds).then((result) => {
      if (!alive) return;
      if (result.ok) setState({ key, data: result.data });
      else if (result.code === "FEATURE_LOCKED") setState({ key, locked: true });
      else setState({ key, error: result.error });
    });
    return () => { alive = false; };
  }, [key, range, reports, timeZone]);

  const current = state?.key === key ? state : null;
  if (!current) return <StateMessage title="Carregando relatórios avançados" busy />;
  if (current.locked) {
    return <Panel title="Relatórios avançados" className="relatorios__advanced-locked">
      <p>Descubra os horários e dias que mais vendem, compare com o período anterior, veja quanto cada pessoa da equipe vendeu e quantos clientes voltam.</p>
      <Button variant="primary" onClick={() => openUpgrade("advanced_reports")}>Conhecer o plano</Button>
    </Panel>;
  }
  if (current.error || !current.data) return <StateMessage tone="danger" title="Relatórios avançados indisponíveis">{current.error}</StateMessage>;
  const r = current.data;
  const series = (rows: { orderCount: number; revenueCents: number }[]) => rows.map((row) => (metric === "revenue" ? row.revenueCents : row.orderCount));
  const busiestHour = [...r.byHour].sort((a, b) => b.revenueCents - a.revenueCents || b.orderCount - a.orderCount)[0];
  const busiestDay = [...r.byWeekday].sort((a, b) => b.revenueCents - a.revenueCents || b.orderCount - a.orderCount)[0];
  const formatValue = (value: number) => (metric === "revenue" ? money(value) : `${value} venda(s)`);

  return <section className="relatorios__advanced" aria-label="Relatórios avançados">
    <Panel title={`Comparado a ${br(r.comparison.previous.fromDate)} – ${br(r.comparison.previous.toDate)}`}>
      <div className="relatorios__deltas">
        <Delta label="Faturamento" delta={r.comparison.revenueCents} format={money} />
        <Delta label="Vendas" delta={r.comparison.orderCount} format={(n) => String(n)} />
        <Delta label="Ticket médio" delta={r.comparison.averageTicketCents} format={money} />
        <Delta label="Cancelamentos" delta={r.comparison.canceledCount} format={(n) => String(n)} inverse />
      </div>
    </Panel>

    <Panel title="Quando você vende" actions={<div className="relatorios__toggle" role="group" aria-label="Medida">
      <Button aria-pressed={metric === "revenue"} onClick={() => setMetric("revenue")} disabled={hidden}>Faturamento</Button>
      <Button aria-pressed={metric === "orders"} onClick={() => setMetric("orders")}>Vendas</Button>
    </div>}>
      {busiestHour && (busiestHour.orderCount > 0) && <p className="relatorios__insight">
        Pico às <strong>{String(busiestHour.hour).padStart(2, "0")}h</strong>{busiestDay && busiestDay.orderCount > 0 && <> · melhor dia: <strong>{WEEKDAYS[busiestDay.weekday - 1]}</strong></>}
      </p>}
      <h3 className="relatorios__subtitle">Por hora do dia</h3>
      <Bars labels={r.byHour.map((h) => `${String(h.hour).padStart(2, "0")}h`)} values={series(r.byHour)} format={formatValue} hideValues={hidden && metric === "revenue"} />
      <h3 className="relatorios__subtitle">Por dia da semana</h3>
      <Bars labels={WEEKDAYS} values={series(r.byWeekday)} format={formatValue} hideValues={hidden && metric === "revenue"} wide />
    </Panel>

    <div className="relatorios__grid">
      <Panel title="Vendas por pessoa da equipe">
        {r.byStaff.length === 0 ? <p className="relatorios__muted">Nenhum pedido aceito ou mesa recebida pela equipe no período.</p>
          : <DataTable label="Vendas por pessoa da equipe" headers={["Pessoa", "Pedidos aceitos", "Mesas recebidas", "Total"]}>
            {r.byStaff.map((s) => <tr key={s.userId}>
              <td>{s.email}</td>
              <td>{s.acceptedOrders} · {money(s.acceptedRevenueCents)}</td>
              <td>{s.tablesReceived} · {money(s.tablesRevenueCents)}</td>
              <td><strong>{money(s.acceptedRevenueCents + s.tablesRevenueCents)}</strong></td>
            </tr>)}
          </DataTable>}
      </Panel>
      <Panel title="Clientes">
        {r.customers.identified === 0 ? <p className="relatorios__muted">Nenhum pedido com telefone no período.</p> : <dl className="relatorios__customers">
          <div><dt>Clientes identificados</dt><dd>{r.customers.identified}</dd></div>
          <div><dt>Voltaram (já compraram antes)</dt><dd>{r.customers.returning}{r.customers.returningPercent !== null && ` · ${r.customers.returningPercent.toLocaleString("pt-BR")}%`}</dd></div>
          <div><dt>Primeira compra</dt><dd>{r.customers.new}</dd></div>
          <div><dt>Compraram 2 vezes ou mais no período</dt><dd>{r.customers.boughtTwiceOrMoreInPeriod}</dd></div>
          <div><dt>Faturamento de quem voltou</dt><dd>{money(r.customers.returningRevenueCents)}</dd></div>
          <div><dt>Faturamento de quem comprou pela 1ª vez</dt><dd>{money(r.customers.newRevenueCents)}</dd></div>
        </dl>}
        <p className="relatorios__muted">Contamos pelo telefone do pedido; o número do cliente não aparece aqui.</p>
      </Panel>
    </div>
  </section>;
}

const br = (date: string) => date.split("-").reverse().join("/");

function Delta({ label, delta, format, inverse = false }: { label: string; delta: ReportDelta; format: (n: number) => string; inverse?: boolean }) {
  const change = delta.changePercent;
  const good = change === null || change === 0 ? null : inverse ? change < 0 : change > 0;
  return <div className="relatorios__delta">
    <span>{label}</span>
    <strong>{format(delta.current)}</strong>
    <small className={good === null ? undefined : good ? "relatorios__up" : "relatorios__down"}>
      {change === null ? `antes: ${format(delta.previous)}` : `${change > 0 ? "▲" : change < 0 ? "▼" : "="} ${Math.abs(change).toLocaleString("pt-BR")}% · antes ${format(delta.previous)}`}
    </small>
  </div>;
}

function Bars({ labels, values, format, hideValues, wide = false }: { labels: string[]; values: number[]; format: (n: number) => string; hideValues: boolean; wide?: boolean }) {
  const max = Math.max(1, ...values);
  return <ol className={wide ? "relatorios__bars relatorios__bars--wide" : "relatorios__bars"}>
    {values.map((value, index) => <li key={labels[index]} title={hideValues ? labels[index] : `${labels[index]}: ${format(value)}`}>
      <span className="relatorios__bar" style={{ blockSize: `${Math.round((value / max) * 100)}%` }} aria-hidden="true" />
      <span className="relatorios__bar-label">{labels[index]}</span>
      <span className="relatorios__sr">{hideValues ? "" : format(value)}</span>
    </li>)}
  </ol>;
}
