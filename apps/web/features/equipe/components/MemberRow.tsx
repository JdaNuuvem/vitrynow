import { useState } from "react";
import type { TeamUser } from "@/core/domain/users";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { Button, StatusBadge } from "@/shared/design/components";

const http = new FetchHttpClient();

// Nome de exibição (aparece no salão como garçom). Vazio = parte do e-mail antes do @.
function NameCell({ user, disabled, onSaved }: { user: TeamUser; disabled: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(user.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const name = value.trim();
    const r = await http.post(`/api/users/${encodeURIComponent(user.id)}/name`, { displayName: name || null });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setEditing(false);
    onSaved();
  }

  if (!editing) {
    return <td>
      {user.displayName || <span className="equipe__muted">—</span>}{" "}
      <Button variant="quiet" disabled={disabled} onClick={() => { setValue(user.displayName ?? ""); setEditing(true); }} aria-label={`Editar o nome de ${user.email}`}>Editar</Button>
    </td>;
  }
  return <td>
    <span className="equipe__name-edit">
      <input value={value} maxLength={40} placeholder="Ex.: Ana" aria-label={`Nome de ${user.email}`} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }} autoFocus />
      <Button variant="primary" busy={busy} onClick={() => void save()}>Salvar</Button>
      <Button variant="quiet" disabled={busy} onClick={() => setEditing(false)}>Cancelar</Button>
    </span>
    {error ? <span className="equipe__error" role="alert">{error}</span> : null}
  </td>;
}

export function MemberRow({ user, onRemove, disabled, onSaved }: { user: TeamUser; onRemove: () => void; disabled: boolean; onSaved: () => void }) {
  return <tr>
    <th scope="row">{user.email}</th>
    <NameCell user={user} disabled={disabled} onSaved={onSaved} />
    <td><StatusBadge tone={user.role === "OWNER" ? "info" : "neutral"}>{user.role === "OWNER" ? "Dono" : "Funcionário"}</StatusBadge></td>
    <td>{user.role === "OWNER" ? "—" : <Button variant="quiet" disabled={disabled} onClick={onRemove}>Remover acesso</Button>}</td>
  </tr>;
}
