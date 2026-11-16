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

export function SummaryCards({ summary }: { summary: ReportSummary }) {
  return (
    <div className="relatorios__cards">
      <StatCard label="Pedidos" value={summary.orderCount} />
      <StatCard label="Faturamento" value={formatCents(summary.revenueCents)} />
      <StatCard label="Ticket médio" value={formatCents(summary.averageTicketCents)} />
      <StatCard label="Descontos (cupons)" value={formatCents(summary.discountCents)} />
    </div>
  );
}
