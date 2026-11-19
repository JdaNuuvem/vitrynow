import type { CashMovement } from "@/core/domain/cashier";
import { formatCents } from "@/shared/format/money";
import { Panel, StateMessage } from "@/shared/design/components";
import { movementReasonLabel } from "@/features/caixa/cashReasons";

export function MovementsList({ movements }: { movements: CashMovement[] }) {
  return (
    <Panel title="Movimentações">
      {movements.length === 0 && <StateMessage title="Nenhuma movimentação registrada." />}
      {movements.map((movement) => (
        <div key={movement.id} className="controlecaixa__movement">
          <span>
            {movement.type === "SUPRIMENTO" ? "+ " : "- "}
            {movementReasonLabel(movement.type, movement.reason)}
            {(movement.reasonText || movement.notes) && <small>{movement.reasonText || movement.notes}</small>}
            <small>
              {new Date(movement.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              {movement.createdByRole && " · " + (movement.createdByRole === "OWNER" ? "Dono" : "Funcionário")}
            </small>
          </span>
          <span>{formatCents(movement.amountCents)}</span>
        </div>
      ))}
    </Panel>
  );
}
