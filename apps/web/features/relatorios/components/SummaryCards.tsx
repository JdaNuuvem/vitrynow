import type { ReportSummary } from "@/core/domain/reports";
import { formatCents } from "@/shared/format/money";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="relatorios__card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function SummaryCards({ summary, financial, hidden }: { summary: ReportSummary; financial: boolean; hidden: boolean }) {
  const money = (cents: number) => hidden ? "Oculto" : formatCents(cents);
  return (
    <div className="relatorios__cards">
      <StatCard label="Pedidos" value={summary.orderCount} />
      {financial ? <>
        {summary.revenueCents !== undefined && <StatCard label={summary.ruleChangedAt ? "Faturamento sem gorjeta" : "Valor dos pedidos"} value={money(summary.revenueCents)} />}
        {summary.averageTicketCents !== undefined && <StatCard label="Ticket médio" value={money(summary.averageTicketCents)} />}
        {summary.discountCents !== undefined && <StatCard label="Descontos (cupons)" value={money(summary.discountCents)} />}
      </> : <>
        <StatCard label="Clientes" value={summary.customerCount} />
        {summary.openCount !== undefined && <StatCard label="Aguardando aceite" value={summary.openCount} />}
        {summary.canceledCount !== undefined && <StatCard label="Cancelados" value={summary.canceledCount} />}
      </>}
    </div>
  );
}
