import type { CashSession } from "@/core/domain/cashier";
import { formatCents } from "@/shared/format/money";
import { activeStoreTimezone, formatInStoreTimezone } from "@/shared/format/storeTime";

export function SessionSummaryCard({ session, expectedBalanceCents }: { session: CashSession; expectedBalanceCents: number }) {
  return (
    <div className="controlecaixa-card">
      <p>Aberto em: {formatInStoreTimezone(session.openedAt, activeStoreTimezone(), { dateStyle: "short", timeStyle: "short" })}</p>
      <p>Abertura: {formatCents(session.openingBalanceCents)}</p>
      <p className="controlecaixa__strong">Saldo esperado: {formatCents(expectedBalanceCents)}</p>
    </div>
  );
}
