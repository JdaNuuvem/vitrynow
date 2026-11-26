"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatQty, MOVEMENT_LABEL, SPOILAGE_REASONS, SYSTEM_WASTE_REASONS, WASTE_REASONS, type MenuMargin, type ProfitReport } from "@/core/domain/stock";
import { extractErrorMessage } from "@/core/http/FetchHttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { DateRangeFilter } from "@/features/relatorios/components/DateRangeFilter";
import { defaultRange, type DateRange } from "@/features/relatorios/dateRange";
import { apiFetch } from "@/lib/api";
import { Button, DataTable, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { useMoney } from "./useMoney";
import "./estoque.css";
import { useStoreTimezone } from "@/features/shell/useStoreTimezone";

const REASON_LABEL: Record<string, string> = { ...WASTE_REASONS, ...SPOILAGE_REASONS, ...SYSTEM_WASTE_REASONS };
const pct = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("pt-BR")}%`);
const CSV_TABLES = [{ id: "summary", label: "Resumo (DRE)" }, { id: "products", label: "Margem por prato" }, { id: "losses", label: "Perdas por motivo" }, { id: "movements", label: "Movimentações" }] as const;

// Lucro de verdade: faturamento − custo do que foi vendido (ficha técnica × custo médio do momento da venda) − perdas
// (desperdício, estragado e falta na contagem). Só o dono: a API recusa a equipe.
export function LucroPage() {
  const { stock } = usePanelServices();
  const role = useCurrentRole();
  const { money, hidden, toggle } = useMoney();
  const timeZone = useStoreTimezone();
  const [range, setRange] = useState<DateRange>(() => defaultRange(new Date(), timeZone));
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [margins, setMargins] = useState<MenuMargin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<(typeof CSV_TABLES)[number]["id"]>("summary");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (role !== "OWNER" || !range.from || !range.to || range.from > range.to) return;
    let alive = true;
    setError(null);
    void Promise.all([stock.profit(range), stock.menuMargins()]).then(([p, m]) => {
      if (!alive) return;
      if (!p.ok) return setError(p.error);
      setReport(p.data);
      if (m.ok) setMargins(m.data.products);
    });
    return () => { alive = false; };
  }, [stock, range, role]);

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await apiFetch(`/api/stock/export.csv?${new URLSearchParams({ from: range.from, to: range.to, table })}`);
      if (!response.ok) return setError(extractErrorMessage(await response.json().catch(() => null)));
      const file = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = file;
      link.download = `estoque-${table}-${range.from}-a-${range.to}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(file), 1000);
    } catch {
      setError("Não foi possível baixar a planilha.");
    } finally {
      setExporting(false);
    }
  }

  if (role && role !== "OWNER") return <main className="estoque"><StateMessage title="Só o dono vê lucro e custos">Peça ao dono da loja.</StateMessage></main>;

  const losses = report?.losses;
  return <main className="estoque">
    <PageHeading title="Lucro e margens" description="Quanto você realmente ganha: vendas menos o custo dos pratos e o que se perdeu."
      actions={<>
        <Button icon={hidden ? "eyeOff" : "eye"} aria-pressed={hidden} onClick={toggle}>{hidden ? "Mostrar valores" : "Ocultar valores"}</Button>
        <Link className="ds-button ds-button--secondary" href="/dashboard/estoque">Ir para o estoque</Link>
      </>} />
    <div className="estoque__toolbar">
      <DateRangeFilter range={range} onChange={setRange} />
      <div className="estoque__export">
        <select aria-label="Planilha" value={table} onChange={(event) => setTable(event.target.value as typeof table)}>
          {CSV_TABLES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <Button busy={exporting} onClick={() => void exportCsv()}>Baixar planilha</Button>
      </div>
    </div>
    {error && <StateMessage tone="danger" title="Relatório indisponível">{error}</StateMessage>}
    {!report && !error && <StateMessage title="Calculando" busy />}
    {report && losses && <>
      {report.lossAlert?.exceeded && <StateMessage tone="warning" title="Perdas acima do normal">
        As perdas do período passaram de {report.lossAlert.thresholdPercent}% do faturamento. Veja abaixo os motivos, os insumos e quem lançou.
      </StateMessage>}
      <section className="estoque__cards" aria-label="Resultado do período">
        <Card label="Faturamento" value={money(report.revenueCents)} note={`${report.orderCount} vendas`} />
        <Card label="Custo dos pratos (CMV)" value={money(report.cogsCents)} note={`${pct(report.cogsPercent)} do faturamento`} />
        <Card label="Lucro bruto" value={money(report.grossProfitCents)} note={`margem ${pct(report.grossMarginPercent)}`} tone={report.grossProfitCents < 0 ? "danger" : "success"} />
        <Card label="Perdas" value={money(losses.totalCents)} note={`${pct(losses.percentOfRevenue)} do faturamento`} tone={losses.totalCents > 0 ? "warning" : undefined} />
        <Card label="Resultado após perdas" value={money(report.resultAfterLossesCents)} tone={report.resultAfterLossesCents < 0 ? "danger" : "success"} strong />
      </section>

      <Panel title="De onde vem o resultado">
        <DataTable label="DRE simplificado" headers={["", "Valor"]}>
          <tr><td>Faturamento</td><td>{money(report.revenueCents)}</td></tr>
          <tr><td>(−) Custo do que foi vendido</td><td>{money(-report.cogsCents)}</td></tr>
          <tr><td><strong>= Lucro bruto</strong></td><td><strong>{money(report.grossProfitCents)}</strong></td></tr>
          <tr><td>(−) Desperdício no preparo</td><td>{money(-losses.wasteCents)}</td></tr>
          <tr><td>(−) Estragado ou vencido</td><td>{money(-losses.spoilageCents)}</td></tr>
          <tr><td>(−) Diferença de contagem</td><td>{money(-losses.adjustmentCents)}</td></tr>
          <tr><td><strong>= Resultado após perdas</strong></td><td><strong>{money(report.resultAfterLossesCents)}</strong></td></tr>
          <tr><td className="estoque__muted">Compras de insumos no período (não entra no resultado: vira estoque)</td><td className="estoque__muted">{money(report.purchasesCents)}</td></tr>
        </DataTable>
      </Panel>

      <Panel title="Margem real por prato vendido">
        {report.products.length === 0 ? <StateMessage title="Nenhuma venda com baixa de estoque no período">Monte as fichas técnicas no estoque: a partir daí cada venda aceita registra o custo.</StateMessage>
          : <DataTable label="Margem por prato" headers={["Prato", "Vendidos", "Faturamento", "Custo", "Lucro", "Margem"]}>
            {report.products.map((p) => <tr key={p.productName}>
              <td>{p.productName}{!p.hasCost && <> <StatusBadge tone="warning">Sem ficha</StatusBadge></>}</td>
              <td>{p.quantity}</td><td>{money(p.revenueCents)}</td><td>{money(p.cogsCents)}</td>
              <td className={p.profitCents < 0 ? "estoque__negative" : undefined}>{money(p.profitCents)}</td><td>{pct(p.marginPercent)}</td>
            </tr>)}
          </DataTable>}
      </Panel>

      <div className="estoque__grid">
        <Panel title="Perdas por motivo">
          {report.lossesByReason.length === 0 ? <StateMessage title="Nenhuma perda registrada" /> : <DataTable label="Perdas por motivo" headers={["Tipo", "Motivo", "Lançamentos", "Custo"]}>
            {report.lossesByReason.map((r) => <tr key={`${r.type}-${r.reason}`}>
              <td>{MOVEMENT_LABEL[r.type as keyof typeof MOVEMENT_LABEL] ?? r.type}</td><td>{REASON_LABEL[r.reason] ?? r.reason}</td><td>{r.count}</td><td>{money(r.costCents)}</td>
            </tr>)}
          </DataTable>}
        </Panel>
        <Panel title="Insumos mais perdidos">
          {report.topWastedIngredients.length === 0 ? <StateMessage title="Nada perdido no período" /> : <DataTable label="Insumos mais perdidos" headers={["Insumo", "Quantidade", "Custo"]}>
            {report.topWastedIngredients.map((i) => <tr key={i.id}><td>{i.name}</td><td>{formatQty(i.quantity, i.unit as never)}</td><td>{money(i.costCents)}</td></tr>)}
          </DataTable>}
        </Panel>
        {report.lossesByUser && report.lossesByUser.length > 0 && <Panel title="Perdas por quem lançou">
          <DataTable label="Perdas por quem lançou" headers={["Quem", "Lançamentos", "Custo"]}>
            {report.lossesByUser.map((u) => <tr key={u.userId ?? "sistema"}><td>{u.email ?? "Sistema (pedido cancelado já preparado)"}</td><td>{u.count}</td><td>{money(u.costCents)}</td></tr>)}
          </DataTable>
        </Panel>}
      </div>
    </>}

    {margins && <Panel title="Margem do cardápio hoje (pelo custo atual dos insumos)">
      <DataTable label="Margem do cardápio" headers={["Prato", "Preço", "Custo da ficha", "CMV", "Margem"]}>
        {[...margins].sort((a, b) => (a.hasRecipe === b.hasRecipe ? (a.marginPercent ?? 0) - (b.marginPercent ?? 0) : a.hasRecipe ? -1 : 1)).map((m) => <tr key={m.id}>
          <td>{m.name}{!m.hasRecipe && <> <StatusBadge tone="warning">Sem ficha</StatusBadge></>}{m.marginCents < 0 && <> <StatusBadge tone="danger">Prejuízo</StatusBadge></>}</td>
          <td>{money(m.priceCents)}{m.perKilo ? "/kg" : ""}</td>
          <td>{m.hasRecipe ? money(m.costCents) : "—"}</td>
          <td>{m.hasRecipe ? pct(m.costPercent) : "—"}</td>
          <td className={m.marginCents < 0 ? "estoque__negative" : undefined}>{m.hasRecipe ? money(m.marginCents) : "—"}</td>
        </tr>)}
      </DataTable>
    </Panel>}
  </main>;
}

function Card({ label, value, note, tone, strong }: { label: string; value: string; note?: string; tone?: "success" | "warning" | "danger"; strong?: boolean }) {
  return <div className={["estoque__card", tone && `estoque__card--${tone}`, strong && "estoque__card--strong"].filter(Boolean).join(" ")}>
    <span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}
  </div>;
}
