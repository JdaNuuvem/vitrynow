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
};

const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const NEW_INTERVAL = { start: "09:00", end: "18:00" };
const EMPTY_SCHEDULE: StoreScheduleInput = { week: WEEKDAYS.map(() => []), exceptions: [], cutoffMinutes: 0 };

function Intervals({ intervals, label, change }: { intervals: Interval[]; label: string; change: (values: Interval[]) => void }) {
  return <div className="operacao__stack">
    {intervals.map((interval, index) => <div className="operacao__row" key={index}>
      <input aria-label={`Abertura de ${label} ${index + 1}`} required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="09:00" value={interval.start} onChange={event => change(intervals.map((value, i) => i === index ? { ...value, start: event.target.value } : value))} />
      <span>até</span>
      <input aria-label={`Fechamento de ${label} ${index + 1}`} required pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" placeholder="18:00" value={interval.end} onChange={event => change(intervals.map((value, i) => i === index ? { ...value, end: event.target.value } : value))} />
      <button type="button" aria-label={`Remover horário de ${label} ${index + 1}`} onClick={() => change(intervals.filter((_, i) => i !== index))}>Remover</button>
    </div>)}
    <div><button type="button" disabled={intervals.length >= 6} onClick={() => change([...intervals, NEW_INTERVAL])}>Adicionar horário</button></div>
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
              <button type="button" onClick={() => setSchedule(current => ({ ...current, exceptions: current.exceptions.filter((_, i) => i !== index) }))}>Remover data</button>
            </div>
            {!exception.closed && <Intervals label={`exceção ${index + 1}`} intervals={exception.intervals ?? []} change={intervals => editException(index, { intervals })} />}
          </fieldset>)}
          <div><button type="button" disabled={schedule.exceptions.length >= 200} onClick={() => setSchedule(current => ({ ...current, exceptions: [...current.exceptions, { date: "", closed: true }] }))}>Adicionar data</button></div>
        </>}
        </fieldset>
        <div><button className="operacao__primary" type="submit" disabled={busy}>Salvar horários</button></div>
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
            {([15, 30, 60] as const).map(minutes => <button type="button" key={minutes} disabled={busy} onClick={() => saveStatus({ action: "PAUSE", minutes })}>Pausar {minutes} min</button>)}
            <button type="button" disabled={busy || !!hours.closedUntil} onClick={() => { setCloseError(null); setConfirmingClose(true); }}>Fechar por hoje</button>
            {(hours.pausedUntil || hours.closedUntil) && <button type="button" className="operacao__primary" disabled={busy} onClick={() => saveStatus({ action: "RESUME" })}>Encerrar pausa</button>}
          </div>
        </section>
        {role === "OWNER" && <form className="operacao__card" onSubmit={event => { event.preventDefault(); void save("prep-times", prep, "Previsões salvas."); }}>
          <h2>Tempo de preparo</h2>
          <small>Deixe em branco quando a loja não fornecer uma previsão.</small>
          <label>Entrega (minutos)<input type="number" min={5} max={240} disabled={busy} value={prep.deliveryMinutes ?? ""} onChange={event => setPrep(current => ({ ...current, deliveryMinutes: event.target.value ? event.target.valueAsNumber : null }))} /></label>
          <label>Retirada (minutos)<input type="number" min={5} max={240} disabled={busy} value={prep.pickupMinutes ?? ""} onChange={event => setPrep(current => ({ ...current, pickupMinutes: event.target.value ? event.target.valueAsNumber : null }))} /></label>
          <div><button className="operacao__primary" disabled={busy}>Salvar previsões</button></div>
        </form>}
      </div>
    </div>}
    <ConfirmDialog open={confirmingClose} title="Fechar o atendimento por hoje?" message="O cardápio deixará de receber novos pedidos até o próximo dia da loja."
      confirmLabel="Fechar por hoje" tone="danger" error={closeError} busy={busy} onConfirm={() => void saveStatus({ action: "CLOSE_TODAY" })}
      onCancel={() => { if (!inFlight.current) setConfirmingClose(false); }} />
  </main>;
}
