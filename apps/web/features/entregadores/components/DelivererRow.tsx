import type { Deliverer } from "@/core/domain/orders";
import { Button, StatusBadge } from "@/shared/design/components";

export function DelivererRow({ deliverer, onToggleActive, onEdit, onRemove, busy }: {
  deliverer: Deliverer;
  onToggleActive: () => void;
  onEdit: () => void;
  onRemove?: () => void;
  busy: boolean;
}) {
  return <tr>
    <th scope="row">{deliverer.name}</th>
    <td>{deliverer.phone || "—"}</td>
    <td><StatusBadge tone={deliverer.active ? "success" : "neutral"}>{deliverer.active ? "Ativo" : "Inativo"}</StatusBadge></td>
    <td><div className="entregadores__actions">
      <Button disabled={busy} onClick={onEdit}>Editar</Button>
      <Button disabled={busy} onClick={onToggleActive}>{deliverer.active ? "Desativar" : "Ativar"}</Button>
      {onRemove && <Button variant="quiet" disabled={busy} onClick={onRemove}>Excluir</Button>}
    </div></td>
  </tr>;
}
