"use client";

import { useRef, useState } from "react";
import type { TeamUser } from "@/core/domain/users";
import { Button, DataTable, PageHeading, Panel, StateMessage } from "@/shared/design/components";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { InviteStaffCard } from "./components/InviteStaffCard";
import { MemberRow } from "./components/MemberRow";
import "./equipe.css";
import { useEquipe } from "./hooks/useEquipe";

export function EquipePage() {
  const { users, forbidden, error, loadError, reload, invite, remove } = useEquipe();
  const [selected, setSelected] = useState<TeamUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function confirmRemoval() {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const message = await remove(selected.id);
      if (message) setFailure(message);
      else setSelected(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <main className="equipe">
    <PageHeading title="Equipe" description="Cadastre funcionários e controle quem pode acessar a loja." />
    {forbidden && <StateMessage title="Acesso do dono da loja" tone="warning">Peça ao dono para gerenciar a equipe.</StateMessage>}
    {loadError && <StateMessage title="Equipe indisponível" tone="danger" action={<Button onClick={() => void reload()}>Tentar novamente</Button>}>{loadError}</StateMessage>}
    {!users && !forbidden && !loadError && <StateMessage title="Carregando equipe" busy />}
    {users && !forbidden && <div className="equipe__grid">
      <Panel title="Membros cadastrados">
        {users.length ? <DataTable label="Equipe da loja" headers={["E-mail", "Perfil", "Ações"]}>
          {users.map((user) => <MemberRow key={user.id} user={user} disabled={busy}
            onRemove={() => { setFailure(null); setSelected(user); }} />)}
        </DataTable> : <StateMessage title="Nenhum membro cadastrado" />}
      </Panel>
      <Panel title="Novo funcionário"><InviteStaffCard error={error} onInvite={invite} /></Panel>
    </div>}
    {selected && <ConfirmDialog open title="Remover acesso da equipe?" message={`${selected.email} perderá acesso ao painel da loja.`}
      tone="danger" confirmLabel="Remover acesso" busy={busy} error={failure} onConfirm={() => void confirmRemoval()}
      onCancel={() => { if (!inFlight.current) setSelected(null); }} />}
  </main>;
}
