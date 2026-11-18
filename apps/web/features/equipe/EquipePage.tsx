"use client";

import { InviteStaffCard } from "./components/InviteStaffCard";
import { MemberRow } from "./components/MemberRow";
import "./equipe.css";
import { useEquipe } from "./hooks/useEquipe";

export function EquipePage() {
  const { users, forbidden, error, invite, remove } = useEquipe();

  if (forbidden) return <main className="equipe">Essa área é restrita ao dono da loja.</main>;

  return (
    <main className="equipe">
      <h1>Equipe</h1>

      <InviteStaffCard error={error} onInvite={invite} />

      <div className="equipe__list">
        {users?.map((user) => <MemberRow key={user.id} user={user} onRemove={remove} />)}
        {users?.length === 0 && <p className="equipe__empty">Nenhum funcionário ainda.</p>}
      </div>
    </main>
  );
}
