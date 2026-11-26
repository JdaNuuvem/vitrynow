"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TABLE_STATUS_LABEL, TABLE_STATUSES, type TableStatus } from "@meucardapio/shared-types";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, StateMessage, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { STATUS_TOKEN_VAR } from "./scene/palette";
import type { FloorElement, FloorElementKind, SalaoTable, Selection, TableAccount, TableShape } from "./types";
import { clearAlert, loadAccount, saveFloor, useSalao } from "./useSalao";
import { AddOrderDialog, ReservationsDrawer, TableCrew, timeOf } from "./SalaoExtras";
import { operationRequest } from "@/features/operacao/storeOperations";
import type { TeamMember } from "./types";
import "./salao.css";

// SALÃO 3D (tela nova). A biblioteca 3D só carrega nesta tela e só no navegador.
const SalaoCanvas = dynamic(() => import("./scene/SalaoCanvas"), { ssr: false, loading: () => <div className="salao-canvas salao-canvas--loading">Montando o salão…</div> });

const STATUS_TONE: Record<TableStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  FREE: "success", OCCUPIED: "danger", WAITING: "info", RESERVED: "warning", CALL_WAITER: "warning", ASK_BILL: "warning", INACTIVE: "neutral",
};
const SHAPE_LABEL: Record<TableShape, string> = { SQUARE: "Quadrada", ROUND: "Redonda", RECT: "Retangular" };
const ELEMENT_LABEL: Record<FloorElementKind, string> = { WALL: "Parede", COUNTER: "Balcão", PLANT: "Planta", DOOR: "Porta" };
const NEW_ELEMENT: Record<FloorElementKind, Omit<FloorElement, "posX" | "posZ">> = {
  WALL: { kind: "WALL", width: 4, depth: 0.15, rotation: 0 },
  COUNTER: { kind: "COUNTER", width: 3, depth: 0.8, rotation: 0 },
  PLANT: { kind: "PLANT", width: 0.8, depth: 0.8, rotation: 0 },
  DOOR: { kind: "DOOR", width: 1, depth: 0.12, rotation: 0 },
};
const rotate = (r: number, step: number) => (((r + step) % 360) + 360) % 360;

function since(iso: string | null) {
  if (!iso) return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function SalaoPage() {
  const owner = useCurrentRole() === "OWNER";
  const { tables, setTables, elements, setElements, error, locked, reloadTables, reloadFloor } = useSalao();
  const [selection, setSelection] = useState<Selection>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [area, setArea] = useState<string>("");
  const [showReservations, setShowReservations] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    void operationRequest<{ user: { userId: string } }>("/auth/me").then((r) => r.ok && setMe(r.data.user.userId));
  }, []);
  useEffect(() => {
    if (owner) void operationRequest<{ users: TeamMember[] }>("/api/users").then((r) => r.ok && setTeam(r.data.users));
  }, [owner]);

  const areas = useMemo(() => [...new Set((tables ?? []).map((t) => t.layout.area).filter((a): a is string => !!a))].sort(), [tables]);
  const visibleTables = useMemo(() => (tables ?? []).filter((t) => !area || t.layout.area === area), [tables, area]);
  const visibleElements = useMemo(() => elements.map((e, i) => ({ e, i })).filter(({ e }) => !area || !e.area || e.area === area), [elements, area]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(TABLE_STATUSES.map((s) => [s, 0])) as Record<TableStatus, number>;
    for (const t of visibleTables) c[t.status] += 1;
    return c;
  }, [visibleTables]);
  const openCents = visibleTables.reduce((sum, t) => sum + t.accountCents, 0);
  const selectedTable = selection?.kind === "table" ? tables?.find((t) => t.id === selection.id) ?? null : null;
  const selectedElement = selection?.kind === "element" ? elements[selection.index] ?? null : null;

  function updateTable(id: string, patch: Partial<SalaoTable["layout"]>) {
    setTables((all) => (all ?? []).map((t) => (t.id === id ? { ...t, layout: { ...t.layout, ...patch } } : t)));
    setDirty(true);
  }
  function updateElement(index: number, patch: Partial<FloorElement>) {
    setElements((all) => all.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    setDirty(true);
  }

  async function save() {
    if (!tables) return;
    setSaving(true);
    const result = await saveFloor(tables, elements);
    setSaving(false);
    if (!result.ok) return setMessage(result.error);
    setDirty(false);
    setEditing(false);
    setMessage("Salão salvo.");
    await Promise.all([reloadTables(), reloadFloor()]);
  }
  async function cancelEdit() {
    setEditing(false);
    setDirty(false);
    setSelection(null);
    await Promise.all([reloadTables(), reloadFloor()]);
  }

  if (locked) {
    return (
      <main className="salao">
        <PageHeading title="Salão 3D" />
        <StateMessage tone="info" title="O salão 3D faz parte do plano PRO" action={<Link className="ds-button ds-button--primary" href="/dashboard/planos">Ver planos</Link>}>
          Veja as mesas do seu salão em 3D, com o status de cada uma em tempo real.
        </StateMessage>
      </main>
    );
  }

  return (
    <main className="salao">
      <PageHeading
        title="Salão 3D"
        description="Suas mesas em tempo real. Gire com o mouse ou o dedo, aproxime com a roda ou pinça e clique numa mesa para ver a conta."
        actions={
          owner ? (
            editing ? (
              <div className="salao__toolbar">
                <Button onClick={() => void cancelEdit()} disabled={saving}>Cancelar</Button>
                <Button variant="primary" busy={saving} disabled={!dirty} onClick={() => void save()}>Salvar salão</Button>
              </div>
            ) : (
              <div className="salao__toolbar"><Button onClick={() => setShowReservations(true)}>Reservas</Button><Button onClick={() => { setEditing(true); setMessage(null); }}>Organizar salão</Button></div>
            )
          ) : (
            <Button onClick={() => setShowReservations(true)}>Reservas</Button>
          )
        }
      />

      {error ? <StateMessage tone="danger" title="Não foi possível carregar o salão">{error}</StateMessage> : null}
      {message ? <StateMessage tone="success" title={message} /> : null}

      <div className="salao__summary" aria-label="Resumo do salão">
        {(["FREE", "OCCUPIED", "RESERVED", "WAITING", "CALL_WAITER", "ASK_BILL"] as TableStatus[]).map((s) => (
          <span key={s} className="salao__chip" style={{ ["--chip" as string]: `var(${STATUS_TOKEN_VAR[s]})` }}>
            <span className="salao__chip-dot" />
            {TABLE_STATUS_LABEL[s]}: <strong>{counts[s]}</strong>
          </span>
        ))}
        <span className="salao__chip salao__chip--money">Em aberto: <strong>{formatCents(openCents)}</strong></span>
        {areas.length ? (
          <label className="salao__area">
            Setor
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">Todos</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {editing ? (
        <div className="salao__editbar" role="toolbar" aria-label="Adicionar ao salão">
          <span className="salao__muted">Arraste mesas e elementos no piso. Adicionar:</span>
          {(Object.keys(NEW_ELEMENT) as FloorElementKind[]).map((k) => (
            <Button key={k} onClick={() => {
              setElements((all) => [...all, { ...NEW_ELEMENT[k], posX: 0, posZ: 0, area: area || null }]);
              setSelection({ kind: "element", index: elements.length });
              setDirty(true);
            }}>{ELEMENT_LABEL[k]}</Button>
          ))}
          <Link className="ds-button ds-button--secondary" href="/dashboard/mesas">Criar ou remover mesas</Link>
        </div>
      ) : null}

      <div className="salao__stage">
        {tables === null ? (
          <div className="salao-canvas salao-canvas--loading">Carregando mesas…</div>
        ) : tables.length === 0 ? (
          <StateMessage title="Nenhuma mesa cadastrada" action={<Link className="ds-button ds-button--primary" href="/dashboard/mesas">Cadastrar mesas</Link>} />
        ) : (
          <SalaoCanvas
            tables={visibleTables}
            elements={visibleElements.map(({ e }) => e)}
            selection={selection?.kind === "element" ? { kind: "element", index: visibleElements.findIndex(({ i }) => i === selection.index) } : selection}
            editing={editing}
            onSelect={(s) => setSelection(s?.kind === "element" ? { kind: "element", index: visibleElements[s.index]?.i ?? -1 } : s)}
            onMoveTable={(id, posX, posZ) => updateTable(id, { posX, posZ })}
            onMoveElement={(index, posX, posZ) => {
              const real = visibleElements[index]?.i;
              if (real !== undefined) updateElement(real, { posX, posZ });
            }}
          />
        )}

        {selectedTable ? (
          editing ? (
            <TableEditor table={selectedTable} onChange={(patch) => updateTable(selectedTable.id, patch)} onClose={() => setSelection(null)} />
          ) : (
            <TablePanel table={selectedTable} owner={owner} me={me} team={team} onClose={() => setSelection(null)} onChanged={() => void reloadTables()} />
          )
        ) : null}
        {showReservations && tables ? <ReservationsDrawer tables={tables} onClose={() => setShowReservations(false)} onChanged={() => void reloadTables()} /> : null}
        {selectedElement && editing && selection?.kind === "element" ? (
          <ElementEditor
            element={selectedElement}
            onChange={(patch) => updateElement(selection.index, patch)}
            onRemove={() => {
              setElements((all) => all.filter((_, i) => i !== selection.index));
              setSelection(null);
              setDirty(true);
            }}
            onClose={() => setSelection(null)}
          />
        ) : null}
      </div>
    </main>
  );
}

function TablePanel({ table, owner, me, team, onClose, onChanged }: { table: SalaoTable; owner: boolean; me: string | null; team: TeamMember[]; onClose: () => void; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [account, setAccount] = useState<TableAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setAccount(null);
    void loadAccount(table.id).then((r) => {
      if (!alive) return;
      if (r.ok) setAccount(r.data);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [table.id, table.accountCents, table.pendingOrders]);

  async function attend(kind: "CALL_WAITER" | "ASK_BILL") {
    setBusy(true);
    const r = await clearAlert(table.id, kind);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onChanged();
  }

  const time = since(table.openedAt);
  return (
    <aside className="salao-panel" aria-label={`Mesa ${table.label}`}>
      <header className="salao-panel__head">
        <span className="salao-panel__number">{table.label}</span>
        <div>
          <h2>Mesa {table.label}</h2>
          <StatusBadge tone={STATUS_TONE[table.status]}>{TABLE_STATUS_LABEL[table.status]}</StatusBadge>
          <p className="salao__muted">
            {[table.layout.area, SHAPE_LABEL[table.layout.shape], `${table.layout.seats} lugares`, time ? `aberta há ${time}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button variant="quiet" onClick={onClose}>Fechar</Button>
      </header>

      {table.askBillAt ? (
        <div className="salao-panel__alert">
          Pediu a conta há {since(table.askBillAt)}.
          <Button busy={busy} onClick={() => void attend("ASK_BILL")}>Atendido</Button>
        </div>
      ) : null}
      {table.callWaiterAt ? (
        <div className="salao-panel__alert">
          Chamou o garçom há {since(table.callWaiterAt)}.
          <Button busy={busy} onClick={() => void attend("CALL_WAITER")}>Atendido</Button>
        </div>
      ) : null}
      {error ? <StateMessage tone="danger" title="Algo deu errado">{error}</StateMessage> : null}
      <TableCrew table={table} owner={owner} me={me} team={team} onChanged={onChanged} />
      {table.nextReservation ? <p className="salao__muted">Próxima reserva: {timeOf(table.nextReservation.startsAt)} · {table.nextReservation.customerName} · {table.nextReservation.partySize}p</p> : null}

      <h3 className="salao-panel__section">Pedidos da conta</h3>
      {!account ? (
        <p className="salao__muted">Carregando…</p>
      ) : account.orders.length === 0 ? (
        <p className="salao__muted">{account.pendingOrders ? `${account.pendingOrders} pedido(s) aguardando aceite.` : "Nenhum pedido em aberto."}</p>
      ) : (
        <ul className="salao-panel__orders">
          {account.orders.map((o) => (
            <li key={o.id}>
              <div className="salao-panel__order-head">
                <strong>Pedido #{o.code}</strong>
                <span className="salao__muted">{new Date(o.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{o.customerName ? ` · ${o.customerName}` : ""}</span>
              </div>
              {o.items.map((it, i) => (
                <div key={i} className="salao-panel__item">
                  <span>{it.quantity}× {it.productName}</span>
                  <span>{formatCents(it.unitPriceCents * it.quantity)}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {account && account.pendingOrders > 0 && account.orders.length > 0 ? <p className="salao__muted">+ {account.pendingOrders} pedido(s) aguardando aceite.</p> : null}

      <div className="salao-panel__total">
        <span>Total parcial</span>
        <strong>{formatCents(account?.totalCents ?? table.accountCents)}</strong>
      </div>
      <div className="salao-panel__actions">
        {account?.pendingOrders ? <Link className="ds-button ds-button--secondary" href="/dashboard/pedidos">Aceitar pedidos</Link> : null}
        {table.active ? <Button onClick={() => setAdding(true)}>Adicionar pedido</Button> : null}
        <Link className="ds-button ds-button--primary" href={`/dashboard/mesas?mesa=${encodeURIComponent(table.id)}`}>Fechar conta</Link>
      </div>
      {adding ? <AddOrderDialog table={table} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChanged(); }} /> : null}
    </aside>
  );
}

function TableEditor({ table, onChange, onClose }: { table: SalaoTable; onChange: (patch: Partial<SalaoTable["layout"]>) => void; onClose: () => void }) {
  const l = table.layout;
  return (
    <aside className="salao-panel" aria-label={`Organizar mesa ${table.label}`}>
      <header className="salao-panel__head">
        <span className="salao-panel__number">{table.label}</span>
        <h2>Mesa {table.label}</h2>
        <Button variant="quiet" onClick={onClose}>Fechar</Button>
      </header>
      <div className="salao-panel__form">
        <label>Formato
          <select value={l.shape} onChange={(e) => onChange({ shape: e.target.value as TableShape })}>
            {(Object.keys(SHAPE_LABEL) as TableShape[]).map((s) => <option key={s} value={s}>{SHAPE_LABEL[s]}</option>)}
          </select>
        </label>
        <label>Lugares
          <input type="number" min={1} max={20} value={l.seats} onChange={(e) => onChange({ seats: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} />
        </label>
        <label>Setor (opcional)
          <input type="text" maxLength={40} value={l.area ?? ""} placeholder="Ex.: Salão, Varanda" onChange={(e) => onChange({ area: e.target.value.trim() ? e.target.value : null })} />
        </label>
        <div className="salao-panel__row">
          <span>Girar</span>
          <Button onClick={() => onChange({ rotation: rotate(l.rotation, -45) })}>↺ 45°</Button>
          <Button onClick={() => onChange({ rotation: rotate(l.rotation, 45) })}>↻ 45°</Button>
        </div>
        <p className="salao__muted">Para mudar de lugar, arraste a mesa no piso.</p>
      </div>
    </aside>
  );
}

function ElementEditor({ element, onChange, onRemove, onClose }: { element: FloorElement; onChange: (patch: Partial<FloorElement>) => void; onRemove: () => void; onClose: () => void }) {
  const size = (v: string) => Math.min(100, Math.max(0.1, Number(v.replace(",", ".")) || 0.1));
  return (
    <aside className="salao-panel" aria-label={ELEMENT_LABEL[element.kind]}>
      <header className="salao-panel__head">
        <h2>{ELEMENT_LABEL[element.kind]}</h2>
        <Button variant="quiet" onClick={onClose}>Fechar</Button>
      </header>
      <div className="salao-panel__form">
        <label>Comprimento (m)
          <input type="number" step={0.25} min={0.1} max={100} value={element.width} onChange={(e) => onChange({ width: size(e.target.value) })} />
        </label>
        {element.kind !== "PLANT" ? (
          <label>Profundidade (m)
            <input type="number" step={0.05} min={0.1} max={100} value={element.depth} onChange={(e) => onChange({ depth: size(e.target.value) })} />
          </label>
        ) : null}
        <div className="salao-panel__row">
          <span>Girar</span>
          <Button onClick={() => onChange({ rotation: rotate(element.rotation, -90) })}>↺ 90°</Button>
          <Button onClick={() => onChange({ rotation: rotate(element.rotation, 45) })}>↻ 45°</Button>
        </div>
        <Button variant="danger" onClick={onRemove}>Remover</Button>
      </div>
    </aside>
  );
}
