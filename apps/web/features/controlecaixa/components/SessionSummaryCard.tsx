import type { CashSession } from "@/core/domain/cashier";
import { formatCents } from "@/shared/format/money";

export function SessionSummaryCard({ session, expectedBalanceCents }: { session: CashSession; expectedBalanceCents: number }) {
  return (
    <div className="controlecaixa-card">
      <p>Aberto em: {new Date(session.openedAt).toLocaleString("pt-BR")}</p>
      <p>Abertura: {formatCents(session.openingBalanceCents)}</p>
      <p className="controlecaixa__strong">Saldo esperado: {formatCents(expectedBalanceCents)}</p>
    </div>
  );
}
