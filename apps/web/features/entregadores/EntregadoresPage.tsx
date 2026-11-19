"use client";

import { useRef, useState } from "react";
import type { Deliverer } from "@/core/domain/orders";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, DataTable, PageHeading, Panel, StateMessage } from "@/shared/design/components";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { DelivererRow } from "./components/DelivererRow";
import { NewDelivererForm } from "./components/NewDelivererForm";
import { useEntregadores } from "./hooks/useEntregadores";
import "./entregadores.css";

export function EntregadoresPage() {
  const { deliverers, error, reload, save, toggleActive, remove } = useEntregadores();
  const role = useCurrentRole();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Deliverer | "new" | null>(null);
  const [deleting, setDeleting] = useState<Deliverer | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const working = useRef(false);
  const term = query.trim().toLocaleLowerCase("pt-BR");
  const visible = deliverers?.filter(({ name, phone }) => name.toLocaleLowerCase("pt-BR").includes(term) || phone?.includes(term));

  async function run(action: () => Promise<string | null>, done?: () => void) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const message = await action();
      if (message) setFailure(message);
      else done?.();
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return <main className="entregadores">
    <PageHeading title="Entregadores" description="Cadastre e organize quem pode receber pedidos para entrega."
      actions={<Button variant="primary" icon="delivery" onClick={() => setEditing("new")}>Novo entregador</Button>} />
    {error && <StateMessage title="Lista indisponível" tone="danger" action={<Button onClick={() => void reload()}>Tentar novamente</Button>}>{error}</StateMessage>}
    {failure && !deleting && <StateMessage title="Alteração não concluída" tone="danger">{failure}</StateMessage>}
    {!deliverers && !error && <StateMessage title="Carregando entregadores" busy />}
    {deliverers && <Panel title="Equipe de entrega">
      <label className="entregadores__search">Buscar por nome ou telefone<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {visible?.length ? <DataTable label="Equipe de entrega" headers={["Entregador", "Telefone", "Status", "Ações"]}>
        {visible.map((deliverer) => <DelivererRow key={deliverer.id} deliverer={deliverer} busy={busy}
          onEdit={() => setEditing(deliverer)} onToggleActive={() => void run(() => toggleActive(deliverer))}
          onRemove={role === "OWNER" ? () => { setFailure(null); setDeleting(deliverer); } : undefined} />)}
      </DataTable> : <StateMessage title={term ? "Nenhum entregador encontrado" : "Nenhum entregador cadastrado"} />}
    </Panel>}
    {editing && <NewDelivererForm initial={editing === "new" ? undefined : editing} save={save} onClose={() => setEditing(null)} />}
    {deleting && <ConfirmDialog open title={`Excluir ${deleting.name}?`} message="O entregador será removido da equipe de entrega." tone="danger"
      confirmLabel="Excluir entregador" busy={busy} error={failure} onConfirm={() => void run(() => remove(deleting.id), () => setDeleting(null))}
      onCancel={() => { if (!working.current) setDeleting(null); }} />}
  </main>;
}
