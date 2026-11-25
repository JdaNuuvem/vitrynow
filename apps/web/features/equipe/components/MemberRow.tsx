import type { TeamUser } from "@/core/domain/users";
import { Button, StatusBadge } from "@/shared/design/components";

export function MemberRow({ user, onRemove, disabled }: { user: TeamUser; onRemove: () => void; disabled: boolean }) {
  return <tr>
    <th scope="row">{user.email}</th>
    <td><StatusBadge tone={user.role === "OWNER" ? "info" : "neutral"}>{user.role === "OWNER" ? "Dono" : "Funcionário"}</StatusBadge></td>
    <td>{user.role === "OWNER" ? "—" : <Button variant="quiet" disabled={disabled} onClick={onRemove}>Remover acesso</Button>}</td>
  </tr>;
}
