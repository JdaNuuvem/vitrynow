"use client";

import { useState, type FormEvent } from "react";
import { HISTORY_DISPLAYS, type HistoryQuery } from "@/core/domain/orderHistory";
import { Button, Field } from "@/shared/design/components";

const periods = [["today", "Hoje"], ["yesterday", "Ontem"], ["7d", "Últimos 7 dias"], ["30d", "Últimos 30 dias"], ["custom", "Personalizado"]] as const;
const statuses = [
  ["ALL", "Todas"], ["ABERTO", "Em aberto"], ["CONCLUIDO", "Concluído"], ["CANCELADO", "Cancelado"],
  ["AGUARDANDO_PAGAMENTO", "Aguardando pagamento"], ["PAGAMENTO_EXPIRADO", "Pagamento expirado"],
] as const;
const types = [["MESA", "Mesa"], ["DELIVERY", "Entrega"], ["BALCAO", "Retirada ou balcão"]] as const;
const payments = [["PIX", "Pix"], ["DINHEIRO", "Dinheiro"], ["CREDITO", "Crédito"], ["DEBITO", "Débito"], ["VR", "Vale-refeição"], ["VA", "Vale-alimentação"]] as const;

export function readHistoryFilters(params: { get: (key: string) => string | null }): HistoryQuery {
  const status = HISTORY_DISPLAYS.find((entry) => entry === params.get("status")) ?? "ALL";
  const period = periods.find(([key]) => key === params.get("period"))?.[0] ?? "7d";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const refund = params.get("refundPending");
  return {
    status,
    ...(status !== "ABERTO" && (period === "custom" ? (dated ? { period, from, to } : { period: "7d" as const }) : { period })),
    q: params.get("q")?.trim().slice(0, 100) || undefined,
    type: types.find(([key]) => key === params.get("type"))?.[0],
    paymentMethod: payments.find(([key]) => key === params.get("paymentMethod"))?.[0],
    refundPending: refund === "true" || refund === "false" ? refund : undefined,
  };
}

export function HistoryFilters({ applied, onApply }: { applied: HistoryQuery; onApply: (filters: HistoryQuery) => void }) {
  const [status, setStatus] = useState(applied.status ?? "ALL");
  const [period, setPeriod] = useState(applied.period ?? "7d");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const filters = readHistoryFilters({ get: (key) => String(form.get(key) ?? "") });
    if (status !== "ABERTO" && period === "custom" && filters.period !== "custom") {
      setError("Confira as datas. A data inicial precisa vir antes da final.");
      return;
    }
    setError("");
    onApply(filters);
  }

  return (
    <form className="historico-filters" aria-label="Filtros do histórico" onSubmit={submit}>
      <Field id="history-query" label="Buscar pedido">
        <input id="history-query" name="q" type="search" maxLength={100} defaultValue={applied.q} placeholder="Número, nome ou telefone" />
      </Field>
      <Field id="history-status" label="Situação">
        <select id="history-status" name="status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          {statuses.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
        </select>
      </Field>
      <Field id="history-period" label="Período">
        <select id="history-period" name="period" disabled={status === "ABERTO"} value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
          {periods.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
        </select>
      </Field>
      {status !== "ABERTO" && period === "custom" && <>
        <Field id="history-from" label="De"><input id="history-from" name="from" type="date" required defaultValue={applied.from} /></Field>
        <Field id="history-to" label="Até"><input id="history-to" name="to" type="date" required defaultValue={applied.to} /></Field>
      </>}
      <Field id="history-type" label="Tipo de pedido">
        <select id="history-type" name="type" defaultValue={applied.type ?? ""}>
          <option value="">Todos</option>{types.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
        </select>
      </Field>
      <Field id="history-payment" label="Pagamento">
        <select id="history-payment" name="paymentMethod" defaultValue={applied.paymentMethod ?? ""}>
          <option value="">Todos</option>{payments.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
        </select>
      </Field>
      <label className="historico-filters__check"><input type="checkbox" name="refundPending" value="true" defaultChecked={applied.refundPending === "true"} /> Estorno pendente</label>
      <div className="historico-filters__actions">
        <Button variant="primary" type="submit" icon="search">Aplicar filtros</Button>
        <Button variant="quiet" onClick={(event) => { event.currentTarget.form?.reset(); setStatus("ALL"); setPeriod("7d"); setError(""); onApply({}); }}>Limpar</Button>
      </div>
      {error && <p className="historico-filters__error" role="alert">{error}</p>}
    </form>
  );
}
