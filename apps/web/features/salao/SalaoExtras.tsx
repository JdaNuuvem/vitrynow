"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RESERVATION_STATUS_LABEL } from "@meucardapio/shared-types";
import type { Menu, OptionSelection, Product } from "@/core/domain/storefront";
import { apiFetch } from "@/lib/api";
import { useStore } from "@/features/shell/StoreProvider";
import { ProductOptionFields } from "@/features/loja/components/ProductOptionFields";
import { choiceLabels, editableSelections, optionChoicesValid, startingPrice, unitPriceWithChoices } from "@/features/loja/productOptions";
import { Button, StateMessage, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { operationRequest } from "@/features/operacao/storeOperations";
import type { Reservation, SalaoTable, TeamMember } from "./types";

// SALÃO 3D — opcionais: garçom e pessoas da mesa, lançar pedido na conta da mesa (mesma rota do pedido do painel) e reservas.
const enc = encodeURIComponent;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Garçom + pessoas, dentro do painel da mesa. */
export function TableCrew({ table, owner, me, team, onChanged }: { table: SalaoTable; owner: boolean; me: string | null; team: TeamMember[]; onChanged: () => void }) {
  const [guests, setGuests] = useState<string>(table.guests ? String(table.guests) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setGuests(table.guests ? String(table.guests) : ""), [table.guests]);

  async function send(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const r = await operationRequest(`/api/tables/${enc(table.id)}/${path}`, "POST", body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onChanged();
  }

  const n = Number(guests);
  const guestsValid = guests === "" || (Number.isInteger(n) && n >= 1 && n <= 50);
  return (
    <div className="salao-panel__form">
      <div className="salao-panel__row salao-panel__row--wrap">
        <span>Garçom</span>
        {owner ? (
          <select value={table.waiter?.id ?? ""} disabled={busy} onChange={(e) => void send("waiter", { userId: e.target.value || null })} aria-label="Garçom responsável">
            <option value="">Ninguém</option>
            {team.map((u) => <option key={u.id} value={u.id}>{u.email.split("@")[0]}</option>)}
          </select>
        ) : table.waiter?.id === me ? (
          <>
            <strong>Você</strong>
            <Button busy={busy} onClick={() => void send("waiter", { userId: null })}>Largar mesa</Button>
          </>
        ) : (
          <>
            <strong>{table.waiter?.name ?? "Ninguém"}</strong>
            {!table.waiter && me ? <Button busy={busy} onClick={() => void send("waiter", { userId: me })}>Assumir mesa</Button> : null}
          </>
        )}
      </div>
      <div className="salao-panel__row salao-panel__row--wrap">
        <label className="salao-panel__inline">Pessoas
          <input type="number" min={1} max={50} value={guests} placeholder="—" onChange={(e) => setGuests(e.target.value)} />
        </label>
        <Button busy={busy} disabled={!guestsValid || guests === String(table.guests ?? "")} onClick={() => void send("guests", { guests: guests === "" ? null : n })}>Salvar</Button>
      </div>
      {error ? <StateMessage tone="danger" title="Não foi possível salvar">{error}</StateMessage> : null}
    </div>
  );
}

/** Lança itens na conta da mesa: usa o MESMO pedido do painel (POST /api/orders, tipo MESA); preço e regras ficam no servidor.
 *  Produtos e opções vêm do cardápio público da loja (o mesmo que o cliente vê); opções são escolhidas com o componente da vitrine. */
type MenuProduct = Product & { category: string };
type Line = { key: number; product: MenuProduct; quantity: number; optionSelections: OptionSelection[] };

export function AddOrderDialog({ table, onClose, onDone }: { table: SalaoTable; onClose: () => void; onDone: () => void }) {
  const store = useStore();
  const [products, setProducts] = useState<MenuProduct[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [choosing, setChoosing] = useState<{ product: MenuProduct; selections: OptionSelection[]; quantity: number } | null>(null);
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const seq = useRef(0);
  const key = useRef(`mesa-${table.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`); // uma chave por abertura (sem pedido duplicado)

  useEffect(() => {
    if (!store?.slug) return;
    void apiFetch(`/stores/${enc(store.slug)}/menu`)
      .then(async (r) => (r.ok ? ((await r.json()) as Menu) : Promise.reject(new Error("menu"))))
      .then((menu) => setProducts(menu.categories.flatMap((c) => c.products.map((p) => ({ ...p, category: c.name })))))
      .catch(() => setError("Não foi possível carregar o cardápio."));
  }, [store?.slug]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (products ?? []).filter((p) => !term || p.name.toLocaleLowerCase("pt-BR").includes(term));
  }, [products, search]);
  const hasGroups = (p: MenuProduct) => (p.optionGroups ?? []).length > 0;
  // venda por peso: a API manda `saleUnit` (o tipo da vitrine ainda não o declara); o peso se lança pela tela de Pedidos
  const byWeight = (p: MenuProduct) => ((p as { saleUnit?: string }).saleUnit ?? "UN") !== "UN";
  const blocked = (p: MenuProduct) => p.soldOut || p.unavailableByOptions || byWeight(p);
  const lineTotal = (l: Line) => unitPriceWithChoices(l.product, { additionalIds: [], optionSelections: l.optionSelections }) * l.quantity;
  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const countOf = (id: string) => lines.filter((l) => l.product.id === id).reduce((s, l) => s + l.quantity, 0);

  function pick(product: MenuProduct) {
    if (hasGroups(product)) return setChoosing({ product, selections: editableSelections(product.optionGroups ?? [], []), quantity: 1 });
    setLines((all) => {
      const same = all.find((l) => l.product.id === product.id && l.optionSelections.length === 0);
      return same ? all.map((l) => (l === same ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l)) : [...all, { key: ++seq.current, product, quantity: 1, optionSelections: [] }];
    });
  }

  async function send() {
    setSending(true);
    setError(null);
    const items = lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, ...(l.optionSelections.length ? { optionSelections: l.optionSelections } : {}) }));
    const r = await operationRequest<{ orderId: string; code: string }>("/api/orders", "POST", { type: "MESA", tableId: table.id, items, ...(notes.trim() ? { notes: notes.trim() } : {}) }, { "Idempotency-Key": key.current });
    setSending(false);
    if (!r.ok) return setError(r.error);
    onDone();
  }

  const groups = choosing?.product.optionGroups ?? [];
  const choiceOk = choosing ? optionChoicesValid(groups, choosing.selections) : false;

  return (
    <div className="salao-overlay" role="dialog" aria-modal="true" aria-label={`Adicionar pedido na mesa ${table.label}`}>
      <div className="salao-dialog">
        <div className="salao-dialog__head">
          <h2>{choosing ? choosing.product.name : `Adicionar pedido · Mesa ${table.label}`}</h2>
          <Button variant="quiet" onClick={choosing ? () => setChoosing(null) : onClose} disabled={sending}>{choosing ? "Voltar" : "Fechar"}</Button>
        </div>

        {choosing ? (
          <>
            {groups.map((group) => (
              <ProductOptionFields key={group.id} group={group} selections={choosing.selections} onChange={(next) => setChoosing({ ...choosing, selections: next })} />
            ))}
            <div className="salao-dialog__actions">
              <div className="salao-dialog__qty">
                <Button variant="quiet" disabled={choosing.quantity <= 1} onClick={() => setChoosing({ ...choosing, quantity: choosing.quantity - 1 })} aria-label="Menos">−</Button>
                <span aria-live="polite">{choosing.quantity}</span>
                <Button variant="quiet" disabled={choosing.quantity >= 99} onClick={() => setChoosing({ ...choosing, quantity: choosing.quantity + 1 })} aria-label="Mais">+</Button>
              </div>
              <Button variant="primary" disabled={!choiceOk} onClick={() => {
                setLines((all) => [...all, { key: ++seq.current, product: choosing.product, quantity: choosing.quantity, optionSelections: editableSelections(groups, choosing.selections) }]);
                setChoosing(null);
              }}>
                Adicionar · {formatCents(unitPriceWithChoices(choosing.product, { additionalIds: [], optionSelections: choosing.selections }) * choosing.quantity)}
              </Button>
            </div>
            {!choiceOk ? <p className="salao__muted">Escolha as opções obrigatórias.</p> : null}
          </>
        ) : (
          <>
            <input type="search" placeholder="Buscar produto" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto" />
            {!products && !error ? <p className="salao__muted">Carregando cardápio…</p> : null}
            <ul className="salao-dialog__products">
              {visible.map((p) => (
                <li key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <span className="salao__muted">
                      {p.category} · {startingPrice(p)}{hasGroups(p) ? " · com opções" : ""}
                      {byWeight(p) ? " · por peso: lance pela tela de Pedidos" : p.soldOut ? " · esgotado" : ""}
                    </span>
                  </div>
                  <div className="salao-dialog__qty">
                    {countOf(p.id) ? <span aria-label={`${countOf(p.id)} no pedido`}>{countOf(p.id)}</span> : null}
                    <Button variant="quiet" disabled={blocked(p)} onClick={() => pick(p)} aria-label={`Adicionar ${p.name}`}>+</Button>
                  </div>
                </li>
              ))}
            </ul>
            {lines.length ? (
              <ul className="salao-dialog__lines" aria-label="Itens do pedido">
                {lines.map((l) => (
                  <li key={l.key}>
                    <span>
                      {l.quantity}× {l.product.name}
                      {l.optionSelections.length ? <span className="salao__muted"> · {choiceLabels(l.product, { additionalIds: [], optionSelections: l.optionSelections }).join(", ")}</span> : null}
                    </span>
                    <span>{formatCents(lineTotal(l))}</span>
                    <Button variant="quiet" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))} aria-label={`Tirar ${l.product.name}`}>✕</Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <label className="salao-panel__inline salao-panel__inline--block">Observação para a cozinha (opcional)
              <input type="text" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {error ? <StateMessage tone="danger" title="Não foi possível lançar">{error}</StateMessage> : null}
            <div className="salao-dialog__actions">
              <span>Itens: <strong>{formatCents(total)}</strong> <span className="salao__muted">(o servidor confere o preço)</span></span>
              <Button variant="primary" busy={sending} disabled={lines.length === 0} onClick={() => void send()}>Enviar para a cozinha</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const STATUS_TONE = { BOOKED: "warning", SEATED: "success", CANCELED: "neutral", NO_SHOW: "danger" } as const;

/** Gaveta de reservas: lista (próximos dias) + nova reserva + chegou / não veio / cancelar. */
export function ReservationsDrawer({ tables, onClose, onChanged }: { tables: SalaoTable[]; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ tableId: "", customerName: "", customerPhone: "", partySize: "2", when: "", durationMin: "90", notes: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await operationRequest<{ reservations: Reservation[] }>("/api/reservations");
    if (r.ok) setList(r.data.reservations);
    else setError(r.error);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    const body = {
      ...(form.tableId ? { tableId: form.tableId } : {}),
      customerName: form.customerName.trim(),
      ...(form.customerPhone.trim() ? { customerPhone: form.customerPhone.trim() } : {}),
      partySize: Number(form.partySize),
      startsAt: new Date(form.when).toISOString(), // datetime-local = hora deste aparelho
      durationMin: Number(form.durationMin),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };
    const r = await operationRequest("/api/reservations", "POST", body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setForm((f) => ({ ...f, customerName: "", customerPhone: "", notes: "" }));
    await load();
    onChanged();
  }

  async function setStatus(id: string, status: Reservation["status"]) {
    const r = await operationRequest(`/api/reservations/${enc(id)}`, "PATCH", { status });
    if (!r.ok) return setError(r.error);
    await load();
    onChanged();
  }

  const valid = form.customerName.trim() && form.when && Number(form.partySize) >= 1;
  return (
    <aside className="salao-panel salao-panel--wide" aria-label="Reservas">
      <header className="salao-dialog__head">
        <h2>Reservas</h2>
        <Button variant="quiet" onClick={onClose}>Fechar</Button>
      </header>
      <div className="salao-panel__form salao-res__form">
        <label>Cliente<input type="text" maxLength={80} value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></label>
        <label>Telefone (opcional)<input type="tel" maxLength={20} value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} /></label>
        <label>Pessoas<input type="number" min={1} max={100} value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></label>
        <label>Dia e hora<input type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} /></label>
        <label>Mesa
          <select value={form.tableId} onChange={(e) => setForm({ ...form, tableId: e.target.value })}>
            <option value="">Escolher na chegada</option>
            {tables.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>Mesa {t.label} ({t.layout.seats} lugares)</option>)}
          </select>
        </label>
        <label>Duração
          <select value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })}>
            {[60, 90, 120, 180].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <label className="salao-res__wide">Observação (opcional)<input type="text" maxLength={300} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <Button variant="primary" busy={busy} disabled={!valid} onClick={() => void create()}>Reservar</Button>
      </div>
      {error ? <StateMessage tone="danger" title="Algo deu errado">{error}</StateMessage> : null}
      {!list ? <p className="salao__muted">Carregando…</p> : list.length === 0 ? <p className="salao__muted">Nenhuma reserva nos próximos dias.</p> : (
        <ul className="salao-res__list">
          {list.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{dayTime(r.startsAt)}</strong> · {r.customerName} · {r.partySize}p{r.tableLabel ? ` · Mesa ${r.tableLabel}` : ""}
                {r.notes ? <div className="salao__muted">{r.notes}</div> : null}
              </div>
              <StatusBadge tone={STATUS_TONE[r.status]}>{RESERVATION_STATUS_LABEL[r.status]}</StatusBadge>
              {r.status === "BOOKED" ? (
                <div className="salao-panel__actions">
                  <Button onClick={() => void setStatus(r.id, "SEATED")}>Chegou</Button>
                  <Button variant="quiet" onClick={() => void setStatus(r.id, "NO_SHOW")}>Não veio</Button>
                  <Button variant="quiet" onClick={() => void setStatus(r.id, "CANCELED")}>Cancelar</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export { timeOf };
