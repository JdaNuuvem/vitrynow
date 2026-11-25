"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PrintJob } from "@/core/gateways/PrintQueueGateway";
import { usePanelServices } from "@/core/services/PanelServices";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { Icon } from "@/shared/icons/Icon";
import "./impressoras.css";
import { activeStoreTimezone, formatInStoreTimezone } from "@/shared/format/storeTime";

const status = { PENDING: "Na fila", CLAIMED: "Em impressão", PRINTED: "Impresso", FAILED: "Falhou", CANCELED: "Cancelado", STALE: "Aguardando retomada" };
const statusTone = { PENDING: "info", CLAIMED: "info", PRINTED: "success", FAILED: "danger", CANCELED: "neutral", STALE: "warning" } as const;
const kind = { ORDER_KITCHEN: "Tíquete da cozinha", ORDER_REPRINT: "Segunda via", ORDER_CANCEL_NOTICE: "Aviso de cancelamento", TEST: "Teste de impressão" };
const date = { format: (value: Date | number) => formatInStoreTimezone(value, activeStoreTimezone(), { dateStyle: "short", timeStyle: "short" }) };

export function PrintQueuePage() {
  const { printQueue } = usePanelServices();
  const owner = useCurrentRole() === "OWNER";
  const [jobs, setJobs] = useState<PrintJob[] | null>(null);
  const [stale, setStale] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PrintJob["status"] | "">("");
  const locked = useRef(false);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    // O resumo classifica os tíquetes antigos antes de a lista ser consultada.
    const summary = await printQueue.summary();
    const list = await printQueue.list();
    if (request !== revision.current) return;
    setLoading(false);
    setStale(summary.ok ? summary.data.stale : null);
    if (list.ok) setJobs(list.data.jobs);
    else if (list.status === 401 || list.status === 403) setJobs(null);
    setError(!list.ok ? list.error : !summary.ok ? summary.error : "");
  }, [printQueue]);
  useEffect(() => { void load(); return () => { revision.current++; }; }, [load]);
  async function enqueue(id?: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setNotice(""); setError("");
    try {
      const result = await (id ? printQueue.printNow(id) : printQueue.test());
      if (!result.ok) { setError(result.error); return; }
      setNotice("Tíquete enviado para a fila.");
      setFilter("");
      await load();
    } finally { locked.current = false; setBusy(false); }
  }
  const visibleJobs = jobs?.filter((job) => !filter || job.status === filter);
  return <main className="impressoras">
    <PageHeading title="Fila de impressão" description="Acompanhe os tíquetes recentes e retome os que ficaram parados."
      actions={<>
        <Button disabled={busy || loading} onClick={() => void load()}>Atualizar</Button>
        {owner && <Button variant="primary" icon="printer" disabled={busy || loading} onClick={() => void enqueue()}>Imprimir teste</Button>}
      </>}>
      <Link className="impressoras__queue-link" href="/dashboard/impressoras">← Impressoras</Link>
    </PageHeading>
    {error && <StateMessage tone="danger" title="A fila precisa de atenção">{error}</StateMessage>}
    {notice && <StateMessage tone="success" title={notice} />}
    {Boolean(stale) && <StateMessage tone="warning" title={stale === 1 ? "1 tíquete aguarda retomada" : `${stale} tíquetes aguardam retomada`} />}
    {!jobs && loading && <StateMessage title="Carregando fila…" busy />}
    {visibleJobs && <Panel title="Últimos tíquetes"
      actions={Boolean(jobs?.length) && <label className="print-settings__filter">Situação
        <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="">Todas</option>
          {Object.entries(status).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>}>
      {!visibleJobs.length && <p className="print-settings__muted">{filter ? "Nenhum tíquete recente nesta situação." : "Nenhum tíquete na fila."}</p>}
      <ul className="print-queue__list" aria-busy={loading}>
        {visibleJobs.map(job => <li key={job.id}>
          <span className="print-queue__icon"><Icon name="printer" size={20} /></span>
          <div className="print-queue__details">
            <strong>{kind[job.kind] ?? "Tíquete"}</strong>
            <small>{date.format(new Date(job.createdAt))} · Tentativas {job.attempts}/{job.maxAttempts}</small>
            {job.failure && <small>{job.failure.message}</small>}
          </div>
          <StatusBadge tone={statusTone[job.status]}>{status[job.status] ?? job.status}</StatusBadge>
          {job.status === "STALE" && <Button disabled={busy || loading} onClick={() => void enqueue(job.id)}>Imprimir agora</Button>}
        </li>)}
      </ul>
    </Panel>}
  </main>;
}
