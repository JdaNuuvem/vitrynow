"use client";

import { useId, useMemo, useState } from "react";
import { formatCents } from "@/shared/format/money";
import type { DayPoint } from "../services/inicioMetrics";
import "./month-chart.css";

type Unit = "revenueCents" | "orderCount";
const units: Record<Unit, string> = { revenueCents: "Valor dos pedidos", orderCount: "Pedidos" };
const monthFormat = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (iso: string) => iso.split("-").reverse().join("/");
const monthLabel = (month: string) => monthFormat.format(new Date(month + "-01T00:00:00Z"));

function formatValue(value: number | null, unit: Unit) {
  if (value === null) return "Sem registro";
  if (unit === "revenueCents") return formatCents(value);
  return value === 1 ? "1 pedido" : `${value} pedidos`;
}

// Each page contains at most one calendar month, so a multi-year report stays usable on a phone.
function monthDays(entries: DayPoint[]): DayPoint[] {
  if (!entries.length) return [];
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const first = entries[0].date;
  const firstDay = Number(first.slice(8));
  const lastDay = Number(entries[entries.length - 1].date.slice(8));
  return Array.from({ length: lastDay - firstDay + 1 }, (_, index) => {
    const date = first.slice(0, 8) + String(firstDay + index).padStart(2, "0");
    return byDate.get(date) ?? { date, orderCount: null, revenueCents: null };
  });
}

export function MonthChart({ series, hideMoney = false }: { series: DayPoint[]; hideMoney?: boolean }) {
  const id = useId();
  const [selectedUnit, setUnit] = useState<Unit>("revenueCents");
  const [selectedMonth, setMonth] = useState("");
  const [selectedDate, setDate] = useState("");
  const [hoveredDate, setHoveredDate] = useState("");
  const groups = useMemo(() => {
    const months = new Map<string, DayPoint[]>();
    for (const point of [...series].sort((a, b) => a.date.localeCompare(b.date))) {
      const key = point.date.slice(0, 7);
      const entries = months.get(key);
      if (entries) entries.push(point);
      else months.set(key, [point]);
    }
    return months;
  }, [series]);
  const months = [...groups.keys()];
  const month = groups.has(selectedMonth) ? selectedMonth : months[months.length - 1];
  const days = monthDays(groups.get(month) ?? []);
  const unit = hideMoney ? "orderCount" : selectedUnit;
  const observed = days.filter((day) => day[unit] !== null);
  const selected = days.find((day) => day.date === selectedDate) ?? observed[observed.length - 1];
  const displayed = days.find((day) => day.date === hoveredDate) ?? selected;
  const max = Math.max(0, ...observed.map((day) => day[unit] ?? 0));

  return (
    <section className="daily-chart" aria-label="Evolução diária dos pedidos">
      <div className="daily-chart__tools">
        {months.length > 1 ? (
          <select aria-label="Mês do gráfico" value={month} onChange={(event) => setMonth(event.target.value)}>
            {months.map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
          </select>
        ) : month ? <span className="daily-chart__month">{monthLabel(month)}</span> : null}
        {!hideMoney && (
          <div className="daily-chart__units" role="group" aria-label="Indicador do gráfico">
            {(["revenueCents", "orderCount"] as const).map((key) => (
              <button key={key} type="button" aria-pressed={key === unit} onClick={() => setUnit(key)}>
                {units[key]}
              </button>
            ))}
          </div>
        )}
      </div>
      {!observed.length || !displayed ? <p className="daily-chart__empty">Sem registros diários neste período.</p> : (
        <>
          <div className="daily-chart__readout" aria-live="polite" aria-atomic="true">
            <span>{shortDate(displayed.date)}</span>
            <strong>{formatValue(displayed[unit], unit)}</strong>
          </div>
          <div className="daily-chart__axis" aria-hidden="true">
            <span>{formatValue(max, unit)}</span><span>0</span>
          </div>
          <fieldset className="daily-chart__plot" onPointerLeave={() => setHoveredDate("")}>
            <legend className="sr-only">{units[unit]} por dia. Selecione uma data.</legend>
            {days.map((point) => {
              const value = point[unit];
              const selectedPoint = point.date === selected.date;
              return (
                <label key={point.date} className="daily-chart__column" title={shortDate(point.date) + " · " + formatValue(value, unit)}
                  onPointerEnter={(event) => { if (event.pointerType === "mouse") setHoveredDate(point.date); }}>
                  <input type="radio" name={id} aria-label={shortDate(point.date) + ", " + formatValue(value, unit)}
                    checked={selectedPoint} onChange={() => { setDate(point.date); setHoveredDate(""); }} />
                  <span aria-hidden="true" className="daily-chart__bar" data-missing={value === null}
                    style={{ height: max > 0 && value !== null ? (value / max) * 100 + "%" : "0%" }} />
                </label>
              );
            })}
          </fieldset>
          <div className="daily-chart__dates" aria-hidden="true">
            <span>{shortDate(days[0].date)}</span>
            {days.length > 1 && <span>{shortDate(days[days.length - 1].date)}</span>}
          </div>
          <details className="daily-chart__data">
            <summary>Ver valores por dia</summary>
            <table>
              <caption>{monthLabel(month)}</caption>
              <thead><tr><th scope="col">Data</th><th scope="col">Pedidos</th>{!hideMoney && <th scope="col">Valor dos pedidos</th>}</tr></thead>
              <tbody>{days.map((point) => (
                <tr key={point.date}>
                  <th scope="row">{shortDate(point.date)}</th>
                  <td>{point.orderCount ?? "Sem registro"}</td>
                  {!hideMoney && <td>{formatValue(point.revenueCents, "revenueCents")}</td>}
                </tr>
              ))}</tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
