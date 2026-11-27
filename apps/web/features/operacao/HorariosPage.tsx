"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, StateMessage, StatusBadge } from "@/shared/design/components";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { operationRequest } from "./storeOperations";
import "./operacao.css";

type Interval = { start: string; end: string };
type StoreScheduleInput = { week: Interval[][]; exceptions: { date: string; closed: boolean; intervals?: Interval[] }[]; cutoffMinutes: number };
type StoreStatusAction = { action: "PAUSE"; minutes: 15 | 30 | 60 } | { action: "RESUME" | "CLOSE_TODAY" };
type PrepTimesInput = { deliveryMinutes: number | null; pickupMinutes: number | null };
type Hours = {
  schedule: StoreScheduleInput | null;
  timezone: string;
  pausedUntil: string | null;
  closedUntil: string | null;
  status: { status: "ABERTO" | "PAUSADO" | "FECHADO"; message: string };
  prepMinutes: { delivery: number | null; pickup: number | null };
  // Modo ocupado (g1): ativo até `busyUntil`; o cliente vê o tempo de preparo + `busyExtraMinutes`.
  busyUntil?: string | null;
  busyExtraMinutes?: number | null;
};
type Suggestion = { schedule: StoreScheduleInput | null; complete: boolean; doubts: { text: string; reason: string }[]; summary: string | null };
const BUSY_MINUTES = [15, 30, 60, 120] as const;
const BUSY_EXTRA = [10, 20, 30] as const;
const clock = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone });

const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const NEW_INTERVAL = { start: "09:00", end: "18:00" };
const EMPTY_SCHEDULE: StoreScheduleInput = { week: WEEKDAYS.map(() => []), exceptions: [], cutoffMinutes: 0 };

function Intervals({ intervals, label, change }: { intervals: Interval[]; label: string; change: (values: Interval[]) => void }) {
  return <div className="operacao__stack">
    {intervals.map((interval, index) => <div className="operacao__row" key={index}>
      <input aria-label={`Abertura de ${label} ${index + 1}`} required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="09:00" value={interval.start} onChange={event => change(intervals.map((value, i) => i === index ? { ...value, start: event.target.value } : value))} />
      <span>até</span>
      <input aria-label={`Fechamento de ${label} ${index + 1}`} required pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" placeholder="18:00" value={interval.end} onChange={event => change(intervals.map((value, i) => i === index ? { ...value, end: event.target.value } : value))} />
      <button className="ds-button ds-button--quiet" type="button" aria-label={`Remover horário de ${label} ${index + 1}`} onClick={() => change(intervals.filter((_, i) => i !== index))}>Remover</button>
    </div>)}
    <div><button className="ds-button" type="button" disabled={intervals.length >= 6} onClick={() => change([...intervals, NEW_INTERVAL])}>Adicionar horário</button></div>
  </div>;
}

export function HorariosPage() {
  const role = useCurrentRole();
  const [hours, setHours] = useState<Hours | null>(null);
  const [schedule, setSchedule] = useState<StoreScheduleInput>(EMPTY_SCHEDULE);
  const [scheduled, setScheduled] = useState(false);
  const [prep, setPrep] = useState<PrepTimesInput>({ deliveryMinutes: null, pickupMinutes: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [busyExtra, setBusyExtra] = useState<(typeof BUSY_EXTRA)[number]>(20);
  const [suggestText, setSuggestText] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const load = useCallback(async () => {
    setError("");
    const result = await operationRequest<{ hours: Hours }>("/api/store/hours");
    if (!result.ok) { setError(result.error); return; }
    const value = result.data.hours;
    setHours(value);
    setSchedule(value.schedule ?? EMPTY_SCHEDULE);
    setScheduled(value.schedule !== null);
    setPrep({ deliveryMinutes: value.prepMinutes.delivery, pickupMinutes: value.prepMinutes.pickup });
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(path: "hours" | "prep-times" | "status", body: unknown, message: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const closing = path === "status" && (body as StoreStatusAction).action === "CLOSE_TODAY";
    if (closing) setCloseError(null);
    try {
      const result = await operationRequest<{ hours: Hours }>(`/api/store/${path}`, "POST", body);
      if (result.ok) {
        setHours(result.data.hours);
        if (path === "hours") {
          setSchedule(result.data.hours.schedule ?? EMPTY_SCHEDULE);
          setScheduled(result.data.hours.schedule !== null);
        }
        if (closing) setConfirmingClose(false);
        setNotice(message);
      } else if (closing) {
        setCloseError(result.error);
      } else {
        setError(result.error);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function editException(index: number, values: Partial<StoreScheduleInput["exceptions"][number]>) {
    setSchedule(current => ({ ...current, exceptions: current.exceptions.map((value, i) => i === index ? { ...value, ...values } : value) }));
  }

  const saveStatus = (action: StoreStatusAction) => save("status", action, "Atendimento atualizado.");

  // Modo ocupado: liga por um tempo (o servidor encerra sozinho) ou encerra antes da hora.
  async function setBusyMode(minutes: (typeof BUSY_MINUTES)[number] | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = minutes === null
        ? await operationRequest<{ hours: Hours }>("/api/store/busy", "DELETE")
        : await operationRequest<{ hours: Hours }>("/api/store/busy", "POST", { minutes, extraMinutes: busyExtra });
      if (!result.ok) return setError(result.error);
      setHours(result.data.hours);
      setNotice(minutes === null ? "Modo ocupado encerrado." : "Modo ocupado ligado.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // Sugestão de grade a partir de texto livre (ou do texto antigo da loja). Só preenche a tela: nada é salvo sem "Salvar horários".
  async function suggest() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSuggestion(null);
    try {
      const result = await operationRequest<{ suggestion: Suggestion }>("/api/store/hours/suggest", "POST", suggestText.trim() ? { text: suggestText.trim() } : {});
      if (!result.ok) return setError(result.error);
      setSuggestion(result.data.suggestion);
      if (result.data.suggestion.schedule) {
        setSchedule(result.data.suggestion.schedule);
        setScheduled(true);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const busyActive = Boolean(hours?.busyUntil);

  return <main className="operacao horarios">
    <PageHeading title="Horários e preparo" description="Defina quando o cardápio recebe pedidos e o tempo estimado de preparo.">
      <Link className="ds-button ds-button--quiet" href="/dashboard/conta">Voltar a Minha loja</Link>
    </PageHeading>
    {error && <p className="operacao__message" role="alert">{error}</p>}
    {notice && <p className="operacao__message" role="status">{notice}</p>}
    {!hours ? error ? <Button onClick={() => void load()}>Tentar novamente</Button> : <StateMessage title="Carregando horários" busy /> : <div className="operacao__grid">
      {role === "OWNER" && <form className="operacao__card" onSubmit={(event: FormEvent) => { event.preventDefault(); void save("hours", { schedule: scheduled ? schedule : null }, "Horários salvos."); }}>
        <h2>Horário semanal</h2>
        <fieldset className="horarios__fields" disabled={busy}>
        <label className="operacao__check"><input type="checkbox" checked={scheduled} onChange={event => setScheduled(event.target.checked)} /> Usar horários automáticos</label>
        <details className="operacao__group">
          <summary>Preencher a partir de um texto</summary>
          <label>Escreva os horários como você divulga (vazio = usa o texto antigo da loja)
            <textarea rows={2} maxLength={500} value={suggestText} placeholder="Ex.: seg a sex 11h às 15h e 18h às 23h; sáb 18h às 00h" onChange={event => setSuggestText(event.target.value)} />
          </label>
          <div><button className="ds-button" type="button" onClick={() => void suggest()}>Sugerir horários</button></div>
          {suggestion && <div role="status" className="operacao__muted">
            {suggestion.schedule ? <>Grade preenchida{suggestion.summary ? `: ${suggestion.summary}` : ""}. Confira e clique em <strong>Salvar horários</strong>.</> : "Não consegui entender os horários. Preencha a grade abaixo."}
            {suggestion.doubts.length > 0 && <ul>{suggestion.doubts.map((doubt, index) => <li key={index}>“{doubt.text}”: {doubt.reason}</li>)}</ul>}
          </div>}
        </details>
        {scheduled && <>
          <small>Fuso da loja {hours.timezone}. Dia sem intervalo fica fechado.</small>
          {WEEKDAYS.map((day, index) => <fieldset className="operacao__group" key={day}>
            <legend>{day}</legend>
            <Intervals label={day} intervals={schedule.week[index]} change={intervals => setSchedule(current => ({ ...current, week: current.week.map((value, i) => i === index ? intervals : value) }))} />
          </fieldset>)}
          <label>Parar de receber antes de fechar (minutos)<input type="number" min={0} max={240} required value={schedule.cutoffMinutes} onChange={event => setSchedule(current => ({ ...current, cutoffMinutes: Number(event.target.value) }))} /></label>
          <h2>Datas especiais</h2>
          {schedule.exceptions.map((exception, index) => <fieldset key={index} className="operacao__group">
            <legend>Exceção {index + 1}</legend>
            <div className="operacao__row">
              <input aria-label={`Data da exceção ${index + 1}`} type="date" required value={exception.date} onChange={event => editException(index, { date: event.target.value })} />
              <label className="operacao__check"><input type="checkbox" checked={exception.closed} onChange={event => editException(index, { closed: event.target.checked })} /> Fechado</label>
              <button className="ds-button ds-button--quiet" type="button" onClick={() => setSchedule(current => ({ ...current, exceptions: current.exceptions.filter((_, i) => i !== index) }))}>Remover data</button>
            </div>
            {!exception.closed && <Intervals label={`exceção ${index + 1}`} intervals={exception.intervals ?? []} change={intervals => editException(index, { intervals })} />}
          </fieldset>)}
          <div><button className="ds-button" type="button" disabled={schedule.exceptions.length >= 200} onClick={() => setSchedule(current => ({ ...current, exceptions: [...current.exceptions, { date: "", closed: true }] }))}>Adicionar data</button></div>
        </>}
        </fieldset>
        <div><button className="ds-button ds-button--primary" type="submit" disabled={busy}>Salvar horários</button></div>
      </form>}
      <div>
        <section className="operacao__card">
          <div className="operacao__row operacao__row--spread"><h2>Atendimento agora</h2>
            <StatusBadge tone={hours.status.status === "ABERTO" ? "success" : hours.status.status === "PAUSADO" ? "warning" : "neutral"}>
              {hours.status.status === "ABERTO" ? "Aberto" : hours.status.status === "PAUSADO" ? "Pausado" : "Fechado"}
            </StatusBadge>
          </div>
          <p role="status">{hours.status.message}</p>
          <div className="operacao__row">
            {([15, 30, 60] as const).map(minutes => <button className="ds-button" type="button" key={minutes} disabled={busy} onClick={() => saveStatus({ action: "PAUSE", minutes })}>Pausar {minutes} min</button>)}
            <button className="ds-button" type="button" disabled={busy || !!hours.closedUntil} onClick={() => { setCloseError(null); setConfirmingClose(true); }}>Fechar por hoje</button>
            {(hours.pausedUntil || hours.closedUntil) && <button type="button" className="ds-button ds-button--primary" disabled={busy} onClick={() => saveStatus({ action: "RESUME" })}>Encerrar pausa</button>}
          </div>
          <h3>Modo ocupado</h3>
          {busyActive && hours.busyUntil ? <div className="operacao__row operacao__row--spread">
            <span role="status"><StatusBadge tone="warning">Ocupado até {clock(hours.busyUntil, hours.timezone)}</StatusBadge>{hours.busyExtraMinutes ? ` · o cliente vê +${hours.busyExtraMinutes} min no preparo` : ""}</span>
            <button type="button" className="ds-button ds-button--primary" disabled={busy} onClick={() => void setBusyMode(null)}>Encerrar modo ocupado</button>
          </div> : <>
            <p className="operacao__muted">Cozinha cheia? Continue recebendo pedidos e avise ao cliente um tempo de preparo maior.</p>
            <label>Tempo a mais no preparo<select value={busyExtra} disabled={busy} onChange={event => setBusyExtra(Number(event.target.value) as (typeof BUSY_EXTRA)[number])}>
              {BUSY_EXTRA.map(extra => <option key={extra} value={extra}>+{extra} min</option>)}
            </select></label>
            <div className="operacao__row">
              {BUSY_MINUTES.map(minutes => <button className="ds-button" type="button" key={minutes} disabled={busy} onClick={() => void setBusyMode(minutes)}>Ocupado por {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}</button>)}
            </div>
          </>}
        </section>
        {role === "OWNER" && <form className="operacao__card" onSubmit={event => { event.preventDefault(); void save("prep-times", prep, "Previsões salvas."); }}>
          <h2>Tempo de preparo</h2>
          <small>Deixe em branco quando a loja não fornecer uma previsão.</small>
          <label>Entrega (minutos)<input type="number" min={5} max={240} disabled={busy} value={prep.deliveryMinutes ?? ""} onChange={event => setPrep(current => ({ ...current, deliveryMinutes: event.target.value ? event.target.valueAsNumber : null }))} /></label>
          <label>Retirada (minutos)<input type="number" min={5} max={240} disabled={busy} value={prep.pickupMinutes ?? ""} onChange={event => setPrep(current => ({ ...current, pickupMinutes: event.target.value ? event.target.valueAsNumber : null }))} /></label>
          <div><button className="ds-button ds-button--primary" disabled={busy}>Salvar previsões</button></div>
        </form>}
      </div>
    </div>}
    <ConfirmDialog open={confirmingClose} title="Fechar o atendimento por hoje?" message="O cardápio deixará de receber novos pedidos até o próximo dia da loja."
      confirmLabel="Fechar por hoje" tone="danger" error={closeError} busy={busy} onConfirm={() => void saveStatus({ action: "CLOSE_TODAY" })}
      onCancel={() => { if (!inFlight.current) setConfirmingClose(false); }} />
  </main>;
}
