"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryZone, ZoneConfig, ZoneFields, ZoneImport, ZoneList } from "@/core/gateways/DeliveryZonesGateway";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, StateMessage, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { ZoneEditor } from "./ZoneEditor";
import { ZoneRules } from "./ZoneRules";
import "./zones.css";

type Dialog = { kind: "edit"; zone?: DeliveryZone } | { kind: "delete"; zone: DeliveryZone };

export function DeliveryZonesPage() {
  const { deliveryZones } = usePanelServices();
  const editable = useCurrentRole() === "OWNER";
  const [list, setList] = useState<ZoneList | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const latest = useRef(0);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<ZoneImport | null>(null);
  const [query, setQuery] = useState("");
  const reload = useCallback(async () => {
    const version = ++latest.current;
    setError(null);
    const response = await deliveryZones.list();
    if (version !== latest.current) return;
    if (response.ok) setList(response.data);
    else {
      if (response.status === 401 || response.status === 403) setList(null);
      setError(response.error);
    }
  }, [deliveryZones]);
  useEffect(() => { void reload(); return () => { latest.current += 1; }; }, [reload]);

  function open(next: Dialog | null) {
    if (locked.current) return;
    setError(null); setMessage(""); setDialog(next);
  }
  async function request<T>(action: () => Promise<HttpResult<T>>, success: (data: T) => void | Promise<void>) {
    if (locked.current || !editable) return;
    locked.current = true;
    setBusy(true); setError(null); setMessage("");
    try {
      const result = await action();
      if (result.ok) await success(result.data);
      else setError(result.error);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function save(fields: ZoneFields) {
    if (dialog?.kind !== "edit") return;
    void request(() => deliveryZones.save(fields, dialog.zone?.id), ({ zone }) => {
      setList(last => last && ({ ...last, zones: [...last.zones.filter(z => z.id !== zone.id), zone].sort((a,b) => a.name.localeCompare(b.name, "pt-BR")) }));
      setDialog(null); setMessage("Bairro salvo.");
    });
  }
  function remove(zone: DeliveryZone) {
    void request(() => deliveryZones.remove(zone.id), () => {
      setList(last => last && ({ ...last, zones: last.zones.filter(z => z.id !== zone.id) }));
      setDialog(null); setMessage("Bairro excluído.");
    });
  }
  function configure(value: Omit<ZoneConfig,"defaultFeeCents">) {
    void request(() => deliveryZones.configure(value), ({ config }) => { setList(last => last && ({ ...last, config })); setMessage("Regras salvas."); });
  }
  function importRows() {
    void request(() => deliveryZones.importText(paste, !preview), async result => {
      if (result.dryRun) { setPreview(result); return; }
      setPreview(null); setPaste(""); setMessage("Importação concluída. Confira a lista de bairros."); await reload();
    });
  }
  const term = query.trim().toLocaleLowerCase("pt-BR");
  const visible = list?.zones.filter(({ name }) => name.toLocaleLowerCase("pt-BR").includes(term)) ?? [];
  return (
    <main className="zones">
      <PageHeading title="Bairros e taxas de entrega" description="Defina onde a loja entrega e quanto custa o frete em cada bairro."
        actions={editable && list && <Button variant="primary" disabled={busy} onClick={() => open({ kind: "edit" })}>Adicionar bairro</Button>}>
        <Link className="ds-button ds-button--quiet" href="/dashboard/conta">Voltar a Minha loja</Link>
      </PageHeading>
      {error && !dialog && <StateMessage title="Alteração indisponível" tone="danger"
        action={<Button disabled={busy} onClick={() => void reload()}>Atualizar lista</Button>}>{error}</StateMessage>}
      {message && <StateMessage title={message} tone="success" />}
      {!list && !error && <StateMessage title="Carregando área de entrega" busy />}
      {list && <div className="zones-grid">
        <section className="zones-panel">
          <h2>Bairros cadastrados <span>{list.zones.length}</span></h2>
          {list.zones.length > 0 && <label className="zones-search">Buscar bairro<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          {visible.length === 0 && <StateMessage title={term ? "Nenhum bairro encontrado" : "Nenhum bairro cadastrado"} />}
          <ul>{visible.map(zone => <li key={zone.id}>
            <div><strong>{zone.name}</strong><small>{zone.etaMinMinutes && `A partir de ${zone.etaMinMinutes} min`}{zone.etaMaxMinutes && `${zone.etaMinMinutes ? " · " : ""}Até ${zone.etaMaxMinutes} min`}</small></div>
            <StatusBadge tone={zone.active ? "success" : "neutral"}>{zone.active ? "Atendido" : "Pausado"}</StatusBadge>
            <b>{formatCents(zone.feeCents)}</b>
            {editable && <div className="zones-actions"><button disabled={busy} onClick={() => open({kind:"edit",zone})}>Editar</button><button disabled={busy} aria-label={`Excluir ${zone.name}`} onClick={() => open({kind:"delete",zone})}>Excluir</button></div>}
          </li>)}</ul>
        </section>
        <div className="zones-side">
          <ZoneRules key={JSON.stringify(list.config)} config={list.config} editable={editable} busy={busy} onSave={configure} />
          {editable && <details className="zones-panel zones-import"><summary>Importar bairros</summary>
            <label>Um bairro por linha, no formato nome; taxa<textarea maxLength={60000} rows={4} value={paste} disabled={busy} onChange={e => {setPaste(e.target.value); setPreview(null);}} placeholder="Centro; 6,00" /></label>
            {preview && <div role="status"><p>{preview.accepted.length} bairro(s) para importar.</p>
              {preview.accepted.map(row => <small key={row.line}>{row.name} · {formatCents(row.feeCents)}</small>)}
              {preview.errors.map(row => <small key={row.line}>Linha {row.line} · {row.reason}</small>)}</div>}
            <button disabled={!paste.trim() || busy || preview?.accepted.length === 0} onClick={importRows}>{preview ? "Confirmar importação" : "Conferir lista"}</button>
          </details>}
        </div>
      </div>}
      {editable && dialog?.kind === "edit" && <ZoneEditor zone={dialog.zone} busy={busy} error={error} onClose={() => open(null)} onSave={save} />}
      {editable && dialog?.kind === "delete" && <ConfirmDialog open title={`Excluir ${dialog.zone.name}?`} message="O bairro será removido da área de entrega." confirmLabel="Excluir bairro" tone="danger" busy={busy} error={error} onCancel={() => open(null)} onConfirm={() => remove(dialog.zone)} />}
    </main>
  );
}
