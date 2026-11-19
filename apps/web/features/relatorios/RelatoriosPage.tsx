"use client";

import { useState } from "react";
import { formatCents } from "@/shared/format/money";
import { TYPE_LABELS } from "@/core/domain/orderLabels";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { MonthChart } from "@/features/inicio/components/MonthChart";
import { useHiddenValues } from "@/features/inicio/hooks/useHiddenValues";
import { Icon } from "@/shared/icons/Icon";
import { Button, PageHeading, Panel, StateMessage } from "@/shared/design/components";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/core/http/FetchHttpClient";
import { DateRangeFilter } from "./components/DateRangeFilter";
import { ReportSection } from "./components/ReportSection";
import { SummaryCards } from "./components/SummaryCards";
import { useRelatorios } from "./hooks/useRelatorios";
import { toDateInput, toReportRange } from "./dateRange";
import "./relatorios.css";

const CSV_TABLES = {
  summary: "Resumo",
  byDay: "Evolução dos pedidos",
  byPaymentMethod: "Formas de pagamento",
  byType: "Tipos de pedido",
  topProducts: "Produtos mais vendidos",
  byDeliverer: "Entregadores",
};
const PAYMENT_LABELS: Record<string, string> = {
  PIX: "Pix", DINHEIRO: "Dinheiro", CREDITO: "Crédito", DEBITO: "Débito", VR: "Vale-refeição", VA: "Vale-alimentação", CARTAO: "Cartão",
};

export function RelatoriosPage() {
  const { summary, range, setRange, reload, loading, error, updatedAt } = useRelatorios();
  const { hidden, toggle } = useHiddenValues();
  const role = useCurrentRole();
  const [table, setTable] = useState<keyof typeof CSV_TABLES>("summary");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const financial = role === "OWNER" && typeof summary?.revenueCents === "number";
  const money = (cents: number) => hidden ? "Oculto" : formatCents(cents);
  const withAmount = (label: string, cents?: number) => financial && cents !== undefined ? label + " · " + money(cents) : label;
  const now = Date.now();
  const today = toDateInput(new Date(now));
  const periods = [1, 7, 30].map((days) => ({
    days,
    from: toDateInput(new Date(now - (days - 1) * 86_400_000)),
    to: today,
  }));

  async function exportCsv() {
    if (exporting || role !== "OWNER") return;
    const { from, to } = toReportRange(range);
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || from > to) return;
    setExporting(true);
    setExportError("");
    try {
      const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), table });
      const response = await apiFetch(`/api/reports/export.csv?${query}`);
      if (!response.ok) {
        setExportError(extractErrorMessage(await response.json().catch(() => null)));
        return;
      }
      const link = document.createElement("a");
      const file = URL.createObjectURL(await response.blob());
      link.href = file;
      link.download = `relatorio-${table}-${range.from}-a-${range.to}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(file), 1000);
    } catch {
      setExportError("Não foi possível baixar o relatório.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="relatorios">
      <PageHeading title="Relatórios" description="Acompanhe vendas, pagamentos e operação por período." actions={
        financial && <Button onClick={toggle} aria-pressed={hidden}>
          <Icon name={hidden ? "eyeOff" : "eye"} size={18} />
          {hidden ? "Mostrar valores" : "Ocultar valores"}
        </Button>} />
      <Panel title="Período do relatório" className="relatorios__period">
      <div className="relatorios__presets" role="group" aria-label="Período rápido">
        {periods.map(({ days, from, to }) => <Button key={days} aria-pressed={range.from === from && range.to === to} onClick={() => setRange({ from, to })}>
          {days === 1 ? "Hoje" : `Últimos ${days} dias`}
        </Button>)}
      </div>
      <div className="relatorios__toolbar">
        <DateRangeFilter range={range} onChange={setRange} />
        <button type="button" className="relatorios__control" onClick={reload} disabled={loading}>
          {loading ? "Atualizando…" : "Atualizar"}
        </button>
        {role === "OWNER" && <div className="relatorios__export">
          <select className="relatorios__control" aria-label="Tabela para exportar" value={table} onChange={event => setTable(event.target.value as keyof typeof CSV_TABLES)}>
            {Object.entries(CSV_TABLES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <Button busy={exporting} disabled={loading || !summary} onClick={() => void exportCsv()}>{exporting ? "Baixando…" : "Baixar CSV"}</Button>
        </div>}
      </div>
      </Panel>
      {exportError && <StateMessage title="Exportação indisponível" tone="danger">{exportError}</StateMessage>}
      {error && <p className="relatorios__notice" role="alert">{error} {summary && updatedAt && (
        <>Exibindo os dados de {updatedAt.toLocaleTimeString("pt-BR")}.</>
      )}</p>}
      {!summary && loading && <StateMessage title="Carregando relatório" busy />}

      {summary && (
        <>
          <SummaryCards summary={summary} financial={financial} hidden={hidden} />
          <Panel title="Evolução dos pedidos" className="relatorios__chart">
            <MonthChart series={summary.byDay.map((day) => ({ ...day, revenueCents: financial ? day.revenueCents ?? null : null }))} hideMoney={hidden || !financial} />
          </Panel>

          <div className="relatorios__grid">
            <ReportSection
              title="Por tipo de pedido"
              emptyText="Sem pedidos no período."
              rows={Object.entries(summary.byType).map(([type, data]) => ({
                key: type,
                label: Object.prototype.hasOwnProperty.call(TYPE_LABELS, type) ? TYPE_LABELS[type as keyof typeof TYPE_LABELS] : type,
                value: withAmount(`${data.count} ${data.count === 1 ? "pedido" : "pedidos"}`, data.revenueCents),
                share: summary.orderCount > 0 ? data.count / summary.orderCount : undefined,
              }))}
            />

            {summary.byPaymentMethod && <ReportSection
              title="Formas de pagamento"
              emptyText="Sem pagamentos no período."
              rows={Object.entries(summary.byPaymentMethod).map(([method, data]) => ({
                key: method,
                label: PAYMENT_LABELS[method] ?? method,
                value: withAmount(`${data.count} ${data.count === 1 ? "pagamento" : "pagamentos"}`, data.revenueCents),
              }))}
            />}

            <ReportSection
              title="Produtos mais vendidos"
              emptyText="Sem vendas no período."
              rows={summary.topProducts.map((product, index) => ({
                key: product.productName + index,
                label: product.productName,
                value: withAmount(`${product.quantity}x`, product.revenueCents),
              }))}
            />

            <ReportSection
              title="Entregadores"
              emptyText="Sem entregas no período."
              rows={summary.byDeliverer.map((deliverer, index) => ({
                key: deliverer.delivererName + index,
                label: deliverer.delivererName,
                value: withAmount(`${deliverer.orderCount} ${deliverer.orderCount === 1 ? "entrega" : "entregas"}`, deliverer.revenueCents),
              }))}
            />

            {financial && summary.cashSummary && <ReportSection
              title="Caixa"
              rows={[
                { key: "sessions", label: "Sessões de caixa abertas no período", value: summary.cashSummary.sessionCount },
                { key: "suprimentos", label: "Suprimentos", value: money(summary.cashSummary.suprimentosCents) },
                { key: "sangrias", label: "Sangrias", value: money(summary.cashSummary.sangriasCents) },
              ]}
            />}
          </div>
        </>
      )}
    </main>
  );
}
