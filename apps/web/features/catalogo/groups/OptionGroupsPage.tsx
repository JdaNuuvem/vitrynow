"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GroupChange, OptionGroup } from "@/core/domain/optionGroups";
import { usePanelServices } from "@/core/services/PanelServices";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { groupRule } from "./groupRules";
import { OptionGroupForm } from "./OptionGroupForm";
import "../catalogo.css";

export function OptionGroupsPage() {
  const { catalog } = usePanelServices();
  const role = useCurrentRole();
  const [groups, setGroups] = useState<OptionGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<OptionGroup | "new" | null>(null);
  const [deleting, setDeleting] = useState<OptionGroup | null>(null);
  const [working, setWorking] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; warnings: string[] } | null>(null);
  const version = useRef(0);
  const mutation = useRef(false);

  const reload = useCallback(async () => {
    const current = ++version.current;
    setError(null);
    try {
      const result = await catalog.listOptionGroups();
      if (current !== version.current) return;
      if (!result.ok) setError(result.error);
      else setGroups(result.data.groups.filter((group) => group.source !== "LEGACY_ADDITIONALS"));
    } catch {
      if (current === version.current) setError("Não foi possível carregar os grupos. Confira a conexão.");
    }
  }, [catalog]);

  useEffect(() => {
    void reload();
    return () => { version.current += 1; };
  }, [reload]);

  function onSaved(result: GroupChange) {
    setEditing(null);
    setNotice({ title: "Grupo salvo.", warnings: result.warnings.map((warning) => warning.message) });
    void reload();
  }

  async function remove() {
    if (!deleting || mutation.current || role !== "OWNER") return;
    mutation.current = true;
    setWorking(true);
    setDeleteError(null);
    try {
      const result = await catalog.deleteOptionGroup(deleting.id);
      if (!result.ok) return setDeleteError(result.error);
      setDeleting(null);
      setNotice({ title: "Grupo excluído.", warnings: [] });
      await reload();
    } catch {
      setDeleteError("Não foi possível excluir o grupo. Confira a conexão e tente novamente.");
    } finally {
      mutation.current = false;
      setWorking(false);
    }
  }

  const term = query.trim().toLocaleLowerCase("pt-BR");
  const visible = groups?.filter((group) => group.name.toLocaleLowerCase("pt-BR").includes(term));
  return (
    <main className="catalogo">
      <PageHeading title="Grupos de opções" description="Crie variações e escolhas para usar em vários produtos."
        actions={<Button variant="primary" onClick={() => setEditing("new")}>Novo grupo</Button>}>
        <Link className="catalogo__link" href="/dashboard/catalogo">Voltar ao catálogo</Link>
      </PageHeading>
      {notice && <div className="catalogo__notice" role="status"><strong>{notice.title}</strong>
        {notice.warnings.length > 0 && <ul>{notice.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      </div>}
      {error && <StateMessage title="Grupos indisponíveis" tone="danger"
        action={<Button onClick={() => void reload()}>Tentar novamente</Button>}>{error}</StateMessage>}
      {!groups && !error && <StateMessage title="Carregando grupos" busy />}
      {!!groups?.length && <label className="catalogo-field catalogo-group__search">Buscar grupo
        <input type="search" placeholder="Nome do grupo" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>}
      {visible?.length === 0 && !error && <StateMessage title={term ? "Nenhum grupo encontrado" : "Nenhum grupo criado"}>
        {term ? "Busque por outro nome." : "Crie um grupo e vincule-o aos produtos no catálogo."}
      </StateMessage>}
      <div className="catalogo-group__grid">
        {visible?.map((group) => (
          <Panel key={group.id} title={group.name} className="catalogo-group__card"
            actions={<StatusBadge tone={group.priceMode === "BASE" ? "info" : "neutral"}>{group.priceMode === "BASE" ? "Variação" : "Complementos"}</StatusBadge>}>
            <p className="catalogo-group__rule">{groupRule(group)}</p>
            {group.helpText && <p className="catalogo-group__rule">{group.helpText}</p>}
            <ul className="catalogo-group__samples">
              {group.options.map((option) => <li key={option.id}><span>{option.name} {!option.active && <small>Indisponível</small>}</span><strong>{formatCents(option.priceCents)}</strong></li>)}
              {!group.options.length && <li>Sem opções cadastradas.</li>}
            </ul>
            <div className="catalogo-group__card-footer">
              <span>{group.productCount ?? 0} {group.productCount === 1 ? "produto" : "produtos"}</span>
              <div>
                <Button onClick={() => setEditing(group)}>Editar</Button>
                {role === "OWNER" && <Button variant="quiet" onClick={() => { setDeleteError(null); setDeleting(group); }}>Excluir</Button>}
              </div>
            </div>
          </Panel>
        ))}
      </div>
      {editing && <OptionGroupForm initial={editing === "new" ? undefined : editing} save={(input, id) => catalog.saveOptionGroup(input, id)}
        onSaved={onSaved} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog open title={`Excluir ${deleting.name}?`}
        message={`O grupo será removido de ${deleting.productCount ?? 0} produto(s). Os pedidos antigos mantêm as escolhas registradas.`}
        confirmLabel="Excluir grupo" tone="danger" busy={working} error={deleteError} onConfirm={() => void remove()}
        onCancel={() => { if (!working) setDeleting(null); }} />}
    </main>
  );
}
