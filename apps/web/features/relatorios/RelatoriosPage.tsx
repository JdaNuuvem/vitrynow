"use client";

import { formatCents } from "@/shared/format/money";
import { DateRangeFilter } from "./components/DateRangeFilter";
import { ReportSection } from "./components/ReportSection";
import { SummaryCards } from "./components/SummaryCards";
import { useRelatorios } from "./hooks/useRelatorios";
import "./relatorios.css";

export function RelatoriosPage() {
  const { summary, range, setRange } = useRelatorios();

  return (
    <main className="relatorios">
      <h1>Relatórios</h1>

      <DateRangeFilter range={range} onChange={setRange} />

      {summary && (
        <>
          <SummaryCards summary={summary} />

          <ReportSection
            title="Por tipo de pedido"
            emptyText="Sem pedidos no período."
            rows={Object.entries(summary.byType).map(([type, data]) => ({
              key: type,
              label: type,
              value: `${data.count} pedido(s) · ${formatCents(data.revenueCents)}`,
            }))}
          />

          <ReportSection
            title="Produtos mais vendidos"
            emptyText="Sem vendas no período."
            rows={summary.topProducts.map((product) => ({
              key: product.productName,
              label: product.productName,
              value: `${product.quantity}x · ${formatCents(product.revenueCents)}`,
            }))}
          />

          <ReportSection
            title="Entregadores"
            emptyText="Sem entregas no período."
            rows={summary.byDeliverer.map((deliverer) => ({
              key: deliverer.delivererName,
              label: deliverer.delivererName,
              value: `${deliverer.orderCount} entrega(s) · ${formatCents(deliverer.revenueCents)}`,
            }))}
          />

          <ReportSection
            title="Caixa"
            rows={[
              { key: "sessions", label: "Sessões de caixa abertas no período", value: summary.cashSummary.sessionCount },
              { key: "suprimentos", label: "Suprimentos", value: formatCents(summary.cashSummary.suprimentosCents) },
              { key: "sangrias", label: "Sangrias", value: formatCents(summary.cashSummary.sangriasCents) },
            ]}
          />
        </>
      )}
    </main>
  );
}
