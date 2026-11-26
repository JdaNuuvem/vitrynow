"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Category } from "@/core/domain/catalog";
import type { OptionGroup } from "@/core/domain/optionGroups";
import { formatQty, MOVEMENT_LABEL, SPOILAGE_REASONS, SYSTEM_WASTE_REASONS, unitCostLabel, WASTE_REASONS, type Ingredient, type MenuMargin, type StockMovement } from "@/core/domain/stock";
import { usePanelServices } from "@/core/services/PanelServices";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, DataTable, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { Tabs } from "@/shared/design/Tabs";
import { useMoney } from "./useMoney";
import { IngredientForm } from "./components/IngredientForm";
import { MovementForm, type MovementKind } from "./components/MovementForm";
import { ProductLossForm } from "./components/ProductLossForm";
import { RecipeEditor } from "./components/RecipeEditor";
import { useEstoque } from "./hooks/useEstoque";
import "./estoque.css";
import { activeStoreTimezone, formatInStoreTimezone } from "@/shared/format/storeTime";

type Tab = "insumos" | "fichas" | "movimentos";
const TABS = [{ id: "insumos", label: "Insumos" }, { id: "fichas", label: "Fichas técnicas" }, { id: "movimentos", label: "Movimentações" }] as const;
const REASON_LABEL: Record<string, string> = { ...WASTE_REASONS, ...SPOILAGE_REASONS, ...SYSTEM_WASTE_REASONS, CONTAGEM_SOBRA: "Sobra na contagem", CONTAGEM_FALTA: "Falta na contagem" };

// "2026-11-28" -> "28/11" (data de calendário, sem fuso).
const shortDate = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;

type RecipeTarget = { kind: "product" | "option"; id: string; title: string; subtitle?: string; priceCents?: number };

export function EstoquePage() {
  const { data, error, reload, run, gateway } = useEstoque();
  const { hidden, toggle } = useMoney();
  const owner = useCurrentRole() === "OWNER";
  const [tab, setTab] = useState<Tab>("insumos");
  const [editing, setEditing] = useState<Ingredient | "new" | null>(null);
  const [moving, setMoving] = useState<{ kind: MovementKind; ingredient: Ingredient } | null>(null);
  const [recipe, setRecipe] = useState<RecipeTarget | null>(null);
  const [dishLoss, setDishLoss] = useState(false);
  const ingredients = data?.ingredients ?? [];

  return <main className="estoque">
    <PageHeading title="Estoque" description="Insumos, fichas técnicas e tudo o que entrou, foi vendido, desperdiçado ou estragou."
      actions={<>
        {owner && <Button icon={hidden ? "eyeOff" : "eye"} aria-pressed={hidden} onClick={toggle}>{hidden ? "Mostrar valores" : "Ocultar valores"}</Button>}
        {owner && <Link className="ds-button ds-button--secondary" href="/dashboard/lucro">Ver lucro e margens</Link>}
        {data && ingredients.length > 0 && <Button onClick={() => setDishLoss(true)}>Perda de prato</Button>}
        {owner && tab === "insumos" && <Button variant="primary" icon="stock" onClick={() => setEditing("new")}>Novo insumo</Button>}
      </>} />
    {error && <StateMessage title="Estoque indisponível" tone="danger" action={<Button onClick={() => void reload()}>Tentar novamente</Button>}>{error}</StateMessage>}
    {!data && !error && <StateMessage title="Carregando estoque" busy />}
    {data && ((data.alerts.expired ?? 0) > 0 || (data.alerts.expiringSoon ?? 0) > 0) && <StateMessage tone={(data.alerts.expired ?? 0) > 0 ? "danger" : "warning"} title="Validade">
      {(data.alerts.expired ?? 0) > 0 && <>{data.alerts.expired} insumo(s) com lote VENCIDO: separe e lance a perda como "Venceu". </>}
      {(data.alerts.expiringSoon ?? 0) > 0 && <>{data.alerts.expiringSoon} insumo(s) vencem nos próximos dias: use primeiro.</>}
    </StateMessage>}
    {data && (data.alerts.negative > 0 || data.alerts.lowStock > 0) && <StateMessage tone={data.alerts.negative > 0 ? "danger" : "warning"} title="Atenção ao estoque">
      {data.alerts.negative > 0 && <>{data.alerts.negative} insumo(s) com saldo NEGATIVO: confira a contagem ou registre a compra. </>}
      {data.alerts.lowStock > 0 && <>{data.alerts.lowStock} insumo(s) abaixo do mínimo.</>}
    </StateMessage>}
    {data && <Tabs label="Seções do estoque" items={TABS} selected={tab} onSelect={setTab}>
      {tab === "insumos" && <IngredientsTab ingredients={ingredients} owner={owner} stockValueCents={data.stockValueCents}
        onEdit={setEditing} onMove={(kind, ingredient) => setMoving({ kind, ingredient })} />}
      {tab === "fichas" && <RecipesTab owner={owner} onOpen={setRecipe} />}
      {tab === "movimentos" && <MovementsTab ingredients={ingredients} owner={owner} onChanged={reload} />}
    </Tabs>}

    {editing && <IngredientForm initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)}
      onSave={(input) => run(() => editing === "new" ? gateway.create(input) : gateway.update(editing.id, { name: input.name, minStockQty: input.minStockQty, active: input.active }))} />}
    {dishLoss && <ProductLossForm gateway={gateway} run={run} onClose={() => setDishLoss(false)} />}
    {moving && <MovementForm kind={moving.kind} ingredient={moving.ingredient} gateway={gateway} run={run} onClose={() => setMoving(null)} />}
    {recipe && <RecipeEditor title={recipe.title} subtitle={recipe.subtitle} priceCents={recipe.priceCents} ingredients={ingredients} owner={owner} onClose={() => setRecipe(null)}
      load={recipe.kind === "product" ? () => gateway.productRecipe(recipe.id) : () => gateway.optionRecipe(recipe.id)}
      save={(items) => recipe.kind === "product" ? gateway.saveProductRecipe(recipe.id, items) : gateway.saveOptionRecipe(recipe.id, items)} />}
  </main>;
}

function IngredientsTab({ ingredients, owner, stockValueCents, onEdit, onMove }: {
  ingredients: Ingredient[];
  owner: boolean;
  stockValueCents?: number;
  onEdit: (ingredient: Ingredient) => void;
  onMove: (kind: MovementKind, ingredient: Ingredient) => void;
}) {
  const { money } = useMoney();
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase("pt-BR");
  const visible = ingredients.filter((i) => i.name.toLocaleLowerCase("pt-BR").includes(term));
  if (ingredients.length === 0) {
    return <StateMessage title="Nenhum insumo cadastrado">
      {owner ? "Cadastre carne, pão, queijo… depois monte a ficha técnica de cada prato: cada venda aceita dá baixa sozinha." : "O dono da loja cadastra os insumos."}
    </StateMessage>;
  }
  return <Panel title="Insumos" actions={owner && stockValueCents !== undefined ? <span className="estoque__value">Estoque valorizado: <strong>{money(stockValueCents)}</strong></span> : undefined}>
    <label className="estoque__search">Buscar insumo<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <DataTable label="Insumos" headers={owner ? ["Insumo", "Saldo", "Mínimo", "Custo médio", "Valor em estoque", "Ações"] : ["Insumo", "Saldo", "Mínimo", "Ações"]}>
      {visible.map((i) => <tr key={i.id} className={i.active ? undefined : "estoque__inactive"}>
        <td>{i.name}{!i.active && <> <StatusBadge>Inativo</StatusBadge></>}</td>
        <td>
          {formatQty(i.stockQty, i.unit)}{" "}
          {i.negative ? <StatusBadge tone="danger">Negativo</StatusBadge> : i.lowStock ? <StatusBadge tone="warning">Abaixo do mínimo</StatusBadge> : null}
          {i.expiry === "EXPIRED" ? <> <StatusBadge tone="danger">Vencido</StatusBadge></> : i.expiry === "SOON" && i.nextExpiresOn ? <> <StatusBadge tone="warning">Vence {shortDate(i.nextExpiresOn)}</StatusBadge></> : null}
        </td>
        <td>{i.minStockQty !== null ? formatQty(i.minStockQty, i.unit) : "—"}</td>
        {owner && <td>{i.unitCostMillicents ? unitCostLabel(i.unitCostMillicents, i.unit) : "—"}</td>}
        {owner && <td>{money(i.stockValueCents ?? 0)}</td>}
        <td className="estoque__row-actions">
          <Button onClick={() => onMove("purchase", i)} disabled={!i.active}>Compra</Button>
          <Button onClick={() => onMove("loss", i)} disabled={!i.active}>Perda</Button>
          {owner && <Button onClick={() => onMove("count", i)}>Contagem</Button>}
          {owner && <Button variant="quiet" onClick={() => onEdit(i)}>Editar</Button>}
        </td>
      </tr>)}
    </DataTable>
    {visible.length === 0 && <StateMessage title="Nenhum insumo encontrado" />}
  </Panel>;
}

function RecipesTab({ owner, onOpen }: { owner: boolean; onOpen: (target: RecipeTarget) => void }) {
  const { catalog, stock } = usePanelServices();
  const { money } = useMoney();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [margins, setMargins] = useState<Map<string, MenuMargin>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cats, opt, marg] = await Promise.all([catalog.listCategories(), catalog.listOptionGroups(), owner ? stock.menuMargins() : Promise.resolve(null)]);
    if (!cats.ok) return setError(cats.error);
    setCategories(cats.data.categories);
    if (opt.ok) setGroups(opt.data.groups.filter((g) => g.source !== "LEGACY_ADDITIONALS"));
    if (marg?.ok) setMargins(new Map(marg.data.products.map((m) => [m.id, m])));
  }, [catalog, stock, owner]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <StateMessage tone="danger" title="Cardápio indisponível">{error}</StateMessage>;
  if (!categories) return <StateMessage title="Carregando cardápio" busy />;
  const open = (target: RecipeTarget) => onOpen(target);

  return <>
    <Panel title="Pratos">
      <p className="estoque__hint">Cada pedido ACEITO baixa do estoque o que está na ficha. Cancelar o pedido devolve (se já foi preparado, vira desperdício). Pratos sem ficha não mexem no estoque.</p>
      <DataTable label="Fichas dos pratos" headers={owner ? ["Prato", "Preço", "Custo da ficha", "CMV", "Margem", ""] : ["Prato", "Preço", ""]}>
        {categories.flatMap((c) => c.products.map((p) => {
          const m = margins.get(p.id);
          return <tr key={p.id}>
            <td>{p.name}<span className="estoque__muted"> · {c.name}</span></td>
            <td>{money(p.priceCents)}</td>
            {owner && <td>{m?.hasRecipe ? money(m.costCents) : <StatusBadge tone="warning">Sem ficha</StatusBadge>}</td>}
            {owner && <td>{m?.hasRecipe && m.costPercent !== null ? `${m.costPercent.toLocaleString("pt-BR")}%` : "—"}</td>}
            {owner && <td className={m && m.marginCents < 0 ? "estoque__negative" : undefined}>{m?.hasRecipe ? money(m.marginCents) : "—"}</td>}
            <td><Button onClick={() => open({ kind: "product", id: p.id, title: p.name, priceCents: p.priceCents })}>{owner ? "Editar ficha" : "Ver ficha"}</Button></td>
          </tr>;
        }))}
      </DataTable>
    </Panel>
    <Panel title="Adicionais e opções">
      <p className="estoque__hint">Ex.: “bacon extra” consome 30 g de bacon. A baixa multiplica pela quantidade escolhida no pedido.</p>
      <DataTable label="Fichas das opções" headers={["Opção", "Grupo", "Preço", ""]}>
        {groups.flatMap((g) => g.options.map((o) => <tr key={o.id}>
          <td>{o.name}</td><td>{g.name}</td><td>{money(o.priceCents)}</td>
          <td><Button onClick={() => open({ kind: "option", id: o.id, title: o.name, subtitle: `Grupo ${g.name}` })}>{owner ? "Editar ficha" : "Ver ficha"}</Button></td>
        </tr>))}
        {categories.flatMap((c) => c.products.flatMap((p) => p.additionals.filter((a) => a.id).map((a) => <tr key={a.id}>
          <td>{a.name}</td><td>Adicional de {p.name}</td><td>{money(a.priceCents)}</td>
          <td><Button onClick={() => open({ kind: "option", id: a.id!, title: a.name, subtitle: `Adicional de ${p.name}` })}>{owner ? "Editar ficha" : "Ver ficha"}</Button></td>
        </tr>)))}
      </DataTable>
    </Panel>
  </>;
}

function MovementsTab({ ingredients, owner, onChanged }: { ingredients: Ingredient[]; owner: boolean; onChanged: () => unknown }) {
  const { stock } = usePanelServices();
  const { money } = useMoney();
  const [ingredientId, setIngredientId] = useState("");
  const [type, setType] = useState("");
  const [rows, setRows] = useState<StockMovement[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  const load = useCallback(async (after?: string) => {
    setError(null);
    const result = await stock.movements({ ingredientId: ingredientId || undefined, type: (type || undefined) as never, cursor: after });
    if (!result.ok) return setError(result.error);
    setRows((current) => (after ? [...(current ?? []), ...result.data.movements] : result.data.movements));
    setCursor(result.data.nextCursor);
  }, [stock, ingredientId, type]);
  useEffect(() => { void load(); }, [load]);

  async function undo(m: StockMovement) {
    if (undoing) return;
    setUndoing(m.id);
    setUndoError(null);
    const result = await stock.undoMovement(m.id);
    setUndoing(null);
    if (!result.ok) return setUndoError(result.error);
    await load();
    await onChanged();
  }
  const losses = type === "LOSS";

  return <Panel title="Movimentações">
    <div className="estoque__filters">
      <label>Insumo<select value={ingredientId} onChange={(event) => setIngredientId(event.target.value)}>
        <option value="">Todos</option>{ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select></label>
      <label>Tipo<select value={type} onChange={(event) => setType(event.target.value)}>
        <option value="">Todos</option><option value="LOSS">Só perdas (desperdício e estragado)</option>{Object.entries(MOVEMENT_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
    </div>
    {error && <StateMessage tone="danger" title="Movimentações indisponíveis">{error}</StateMessage>}
    {!rows && !error && <StateMessage title="Carregando" busy />}
    {rows && rows.length === 0 && <StateMessage title="Nenhuma movimentação" />}
    {undoError && <StateMessage tone="danger" title="Não foi possível desfazer">{undoError}</StateMessage>}
    {losses && <p className="estoque__hint">Lançou errado? “Desfazer” devolve o saldo (perda de prato desfaz o prato todo). A equipe desfaz só a própria perda, até 30 minutos depois.</p>}
    {rows && rows.length > 0 && <DataTable label="Movimentações" headers={[ "Quando", "Insumo", "Tipo", "Motivo", "Quantidade", ...(owner ? ["Custo"] : []), "Quem", ""]}>
      {rows.map((m) => <tr key={m.id}>
        <td>{formatInStoreTimezone(m.createdAt, activeStoreTimezone(), { dateStyle: "short", timeStyle: "short" })}</td>
        <td>{m.ingredient.name}</td>
        <td>{MOVEMENT_LABEL[m.type]}</td>
        <td>{m.reversalOfId ? "Desfeito: " : ""}{m.reason ? REASON_LABEL[m.reason] ?? m.reason : "—"}{m.note && <span className="estoque__muted"> · {m.note}</span>}{m.expiresOn && <span className="estoque__muted"> · validade {shortDate(m.expiresOn)}</span>}</td>
        <td className={m.quantity < 0 ? "estoque__negative" : "estoque__positive"}>{m.quantity > 0 ? "+" : ""}{formatQty(m.quantity, m.ingredient.unit)}</td>
        {owner && <td>{money(m.costCents ?? 0)}</td>}
        <td className="estoque__muted">{m.userEmail ?? (m.orderId ? "Pedido" : "Sistema")}</td>
        <td>{m.undone ? <StatusBadge>Desfeito</StatusBadge> : m.canUndo ? <Button variant="quiet" busy={undoing === m.id} onClick={() => void undo(m)}>Desfazer</Button> : null}</td>
      </tr>)}
    </DataTable>}
    {cursor && <Button onClick={() => void load(cursor)}>Carregar mais</Button>}
  </Panel>;
}
