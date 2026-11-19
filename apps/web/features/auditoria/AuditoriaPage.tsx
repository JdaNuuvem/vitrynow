"use client";

import { useState } from "react";
import { auditActionLabel } from "@/core/domain/auditLabels";
import { Button, DataTable, PageHeading, Panel, StateMessage } from "@/shared/design/components";
import "./auditoria.css";
import { LogRow } from "./components/LogRow";
import { useAuditoria } from "./hooks/useAuditoria";

const calendar = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short" });

export function AuditoriaPage() {
  const { logs, forbidden, error, reload } = useAuditoria();
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const actionTypes = [...new Set(logs?.map((log) => log.action))].sort((a, b) => auditActionLabel(a).localeCompare(auditActionLabel(b), "pt-BR"));
  const datesInvalid = !!(from && to && from > to);
  const filtered = logs?.filter((log) => {
    const day = calendar.format(new Date(log.createdAt));
    return (!action || log.action === action) && (!from || day >= from) && (!to || day <= to);
  });

  return <main className="auditoria">
    <PageHeading title="Auditoria" description="Consulte as últimas 200 ações registradas na loja." />
    {forbidden && <StateMessage title="Acesso do dono da loja" tone="warning">Peça ao dono para consultar o histórico.</StateMessage>}
    {error && <StateMessage title="Histórico indisponível" tone="danger" action={<Button onClick={() => void reload()}>Tentar novamente</Button>}>{error}</StateMessage>}
    {!logs && !forbidden && !error && <StateMessage title="Carregando histórico" busy />}
    {logs && !forbidden && <Panel title="Atividade recente" actions={<Button onClick={() => void reload()}>Atualizar</Button>}>
      <div className="auditoria-filters">
        <label>Ação<select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Todas as ações</option>
          {actionTypes.map((type) => <option key={type} value={type}>{auditActionLabel(type)}</option>)}
        </select></label>
        <label>De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Até<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <Button disabled={!action && !from && !to} onClick={() => { setAction(""); setFrom(""); setTo(""); }}>Limpar filtros</Button>
      </div>
      {datesInvalid ? <StateMessage title="Período inválido" tone="warning">A data final deve ser igual ou posterior à inicial.</StateMessage>
        : filtered?.length ? <DataTable label="Histórico de auditoria" headers={["Ação", "Origem", "Data e hora"]}>
          {filtered.map((log) => <LogRow key={log.id} log={log} />)}
        </DataTable> : <StateMessage title={logs.length ? "Nenhuma ação com esses filtros" : "Nenhuma ação registrada"} />}
    </Panel>}
  </main>;
}
