import type { CashMovement } from "@/core/domain/cashier";
import { formatCents } from "@/shared/format/money";

export function MovementsList({ movements }: { movements: CashMovement[] }) {
  return (
    <div className="controlecaixa-card">
      <h2>Movimentações</h2>
      {movements.length === 0 && <p className="controlecaixa__muted">Nenhuma ainda.</p>}
      {movements.map((movement) => (
        <div key={movement.id} className="controlecaixa__movement">
          <span>
            {movement.type === "SUPRIMENTO" ? "+ " : "- "}
            {movement.notes || movement.type}
          </span>
          <span>{formatCents(movement.amountCents)}</span>
        </div>
      ))}
    </div>
  );
}
