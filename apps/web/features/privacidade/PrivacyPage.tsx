"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { HttpResult } from "@/core/http/HttpClient";
import { Button, PageHeading, Panel, StateMessage } from "@/shared/design/components";
import { PrivacyConfirmation, type PrivacyAction } from "./PrivacyConfirmation";
import { privacyApi, type PrivacyPreview, type PrivacyReauth, type PrivacyTarget } from "./privacyApi";
import { useStoreTimezone } from "@/features/shell/useStoreTimezone";
import { formatInStoreTimezone } from "@/shared/format/storeTime";

type Lookup = { target: PrivacyTarget; preview: PrivacyPreview };

export function PrivacyPage() {
  const timeZone = useStoreTimezone();
  const DATE = { format: (date: Date) => formatInStoreTimezone(date, timeZone, { dateStyle: "short" }) };
  const [access, setAccess] = useState<HttpResult<{ reauth: PrivacyReauth }> | null>(null);
  const [revision, setRevision] = useState(0);
  const [kind, setKind] = useState<"phone" | "orderCode">("phone");
  const [term, setTerm] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [action, setAction] = useState<PrivacyAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; tone: "success" | "danger" } | null>(null);
  const lookingUp = useRef(false);

  useEffect(() => {
    let active = true;
    privacyApi.status().then((result) => { if (active) setAccess(result); });
    return () => { active = false; };
  }, [revision]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lookingUp.current) return;
    const value = term.trim().replace(kind === "phone" ? /[^\d]/g : /^#\s*/, "");
    if (kind === "phone" ? value.length < 8 : !value) {
      setFeedback({ message: kind === "phone" ? "Informe um telefone válido." : "Informe o código do pedido.", tone: "danger" });
      return;
    }
    const target = kind === "phone" ? { phone: value } : { orderCode: value };
    lookingUp.current = true;
    setBusy(true);
    setFeedback(null);
    setLookup(null);
    const response = await privacyApi.preview(target);
    setBusy(false);
    lookingUp.current = false;
    if (response.ok) setLookup({ target, preview: response.data });
    else if (response.code === "FEATURE_DISABLED" || response.status === 401 || response.code === "FORBIDDEN_ROLE") setAccess(response);
    else setFeedback({ message: response.error, tone: "danger" });
  }

  function clearResult(clearTerm: boolean) {
    setLookup(null);
    setAction(null);
    setFeedback(null);
    if (clearTerm) setTerm("");
  }

  function sessionMessage(result: Exclude<NonNullable<typeof access>, { ok: true }>) {
    if (result.status === 401) return <StateMessage tone="warning" title="Sessão encerrada" action={<Link className="ds-button ds-button--primary" href="/login">Entrar</Link>} />;
    if (result.code === "FEATURE_DISABLED") return <StateMessage title="Privacidade indisponível neste ambiente" />;
    if (result.status === 403) return <StateMessage tone="warning" title="Área exclusiva do dono da loja" />;
    return <StateMessage tone="danger" title="Falha ao consultar acesso" action={<Button onClick={() => {
      setAccess(null); setRevision((value) => value + 1);
    }}>Tentar novamente</Button>}>{result.error}</StateMessage>;
  }

  return <main className="privacy-page">
    <PageHeading title="Privacidade" description="Consulte pedidos para exportar ou anonimizar os dados pessoais de um cliente da loja." />
    {!access ? <StateMessage busy title="Verificando acesso…" /> : !access.ok ? sessionMessage(access) : <>
      <Panel title="Buscar pedidos">
        <form className="privacy-filter" onSubmit={search}>
          <label className="platform-field">Buscar por<select value={kind} onChange={(event) => {
            setKind(event.target.value as typeof kind); clearResult(true);
          }} disabled={busy}>
            <option value="phone">Telefone</option><option value="orderCode">Código do pedido</option>
          </select></label>
          <label className="platform-field">{kind === "phone" ? "Telefone do cliente" : "Código do pedido"}
            <input type={kind === "phone" ? "tel" : "text"} value={term} maxLength={kind === "phone" ? 30 : 21}
              autoComplete="off" required disabled={busy} onChange={(event) => { setTerm(event.target.value); clearResult(false); }} />
          </label>
          <Button type="submit" variant="primary" busy={busy}>{busy ? "Consultando…" : "Consultar pedidos"}</Button>
        </form>
      </Panel>
      {feedback && <StateMessage title={feedback.message} tone={feedback.tone} />}
      {lookup && <Panel title="Resultado da consulta">
        <div className="privacy-result">
          <div className="privacy-summary"><span>Pedidos com dados pessoais</span><strong>{lookup.preview.orders}</strong></div>
          {lookup.preview.period && <p>Período de {DATE.format(new Date(lookup.preview.period.from))} a {DATE.format(new Date(lookup.preview.period.to))}.</p>}
          {lookup.preview.phoneMasked && <p>Consulta pelo telefone {lookup.preview.phoneMasked}.</p>}
          {lookup.preview.otherOrdersSamePhone > 0 && <StateMessage tone="warning" title="Há outros pedidos com o mesmo telefone">
            {lookup.preview.otherOrdersSamePhone} {lookup.preview.otherOrdersSamePhone === 1 ? "pedido ficou" : "pedidos ficaram"} fora desta consulta. Use o telefone para consultar todos.
          </StateMessage>}
          {lookup.preview.blocked && <StateMessage tone="warning" title="Anonimização bloqueada">
            <ul className="privacy-blockers">{lookup.preview.blockers.map((blocker) => <li key={blocker.code}>
              Pedido #{blocker.code} · {blocker.reason === "REFUND_PENDING" ? "Estorno em andamento" : "Pedido em andamento"}
            </li>)}</ul>
          </StateMessage>}
          {lookup.preview.orders === 0 ? <p>Nenhum pedido com dados pessoais foi encontrado.</p> : <div className="platform-actions">
            <Button variant="primary" onClick={() => setAction("export")}>Exportar JSON</Button>
            <Button variant="danger" disabled={lookup.preview.blocked} onClick={() => setAction("anonymize")}>Anonimizar dados</Button>
          </div>}
        </div>
      </Panel>}
      {action && lookup && <PrivacyConfirmation action={action} target={lookup.target} preview={lookup.preview}
        onCancel={() => setAction(null)} onDone={(message) => { clearResult(true); setFeedback({ message, tone: "success" }); }}
        onStale={(message) => { clearResult(false); setFeedback({ message, tone: "danger" }); }} />}
    </>}
  </main>;
}
