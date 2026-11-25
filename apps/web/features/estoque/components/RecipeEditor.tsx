"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BIG_UNIT, formatQty, type Ingredient, type Recipe } from "@/core/domain/stock";
import type { HttpResult } from "@/core/http/HttpClient";
import { Button, StateMessage } from "@/shared/design/components";
import { useMoney } from "../useMoney";
import { Modal } from "@/shared/ui/Modal";
import { inputUnitOptions, toBaseQty, type InputUnit } from "../quantity";

type Row = { key: number; ingredientId: string; qty: string; unit: InputUnit };

// Ficha técnica de um PRATO ou de uma OPÇÃO/ADICIONAL: quanto de cada insumo UMA unidade vendida consome
// (prato por peso: por 1 kg vendido). Salvar substitui a ficha inteira. A baixa acontece quando o pedido é ACEITO.
export function RecipeEditor({ title, subtitle, priceCents, load, save, ingredients, owner, onClose }: {
  title: string;
  subtitle?: string;
  priceCents?: number;
  load: () => Promise<HttpResult<Recipe>>;
  save: (items: { ingredientId: string; quantity: number }[]) => Promise<HttpResult<Recipe>>;
  ingredients: Ingredient[];
  owner: boolean;
  onClose: () => void;
}) {
  const heading = useId();
  const { money } = useMoney();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [perKilo, setPerKilo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const inFlight = useRef(false);
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const active = ingredients.filter((i) => i.active);

  useEffect(() => {
    let alive = true;
    void load().then((result) => {
      if (!alive) return;
      if (!result.ok) return setError(result.error);
      setPerKilo(!!result.data.perKilo);
      setRows(result.data.items.map((item) => {
        const big = BIG_UNIT[item.unit];
        const useBig = !!big && item.quantity >= big.factor && item.quantity % (big.factor / 1000) === 0;
        return { key: ++seq.current, ingredientId: item.ingredientId, unit: useBig ? "big" : "base", qty: String(useBig ? item.quantity / big!.factor : item.quantity).replace(".", ",") };
      }));
    });
    return () => { alive = false; };
  }, [load]);

  const parsed = (rows ?? []).map((row) => {
    const ingredient = byId.get(row.ingredientId);
    const quantity = ingredient ? toBaseQty(row.qty, ingredient.unit, row.unit) : null;
    return { row, ingredient, quantity };
  });
  // Custo estimado pelo custo médio ATUAL (o que fica gravado em cada venda é o custo do momento da baixa).
  const costCents = Math.round(parsed.reduce((sum, p) => sum + (p.quantity ?? 0) * (p.ingredient?.unitCostMillicents ?? 0), 0) / 1000);

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current?.map((row) => (row.key === key ? { ...row, ...patch } : row)) ?? null);
  }

  async function submit() {
    if (inFlight.current || !rows) return;
    const items = parsed.filter((p) => p.row.ingredientId);
    if (items.some((p) => !p.quantity || p.quantity <= 0)) return setError("Confira as quantidades: todas precisam ser maiores que zero.");
    if (new Set(items.map((p) => p.row.ingredientId)).size !== items.length) return setError("O mesmo insumo aparece duas vezes.");
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await save(items.map((p) => ({ ingredientId: p.row.ingredientId, quantity: p.quantity! })));
      if (!result.ok) setError(result.error);
      else onClose();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <Modal open labelledBy={heading} width={640} sheetOnMobile onClose={() => { if (!inFlight.current) onClose(); }}>
    <form className="estoque__form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id={heading}>Ficha técnica · {title}</h2>
      {subtitle && <p className="estoque__hint">{subtitle}</p>}
      <p className="estoque__hint">{perKilo ? "Produto vendido por peso: informe quanto de cada insumo vai em 1 kg vendido." : "Informe quanto de cada insumo vai em UMA unidade vendida. Ex.: hambúrguer = 180 g de carne + 1 pão."}</p>
      {!rows && !error && <StateMessage title="Carregando ficha" busy />}
      {rows && active.length === 0 && <StateMessage title="Nenhum insumo cadastrado">Cadastre os insumos na aba Insumos antes de montar a ficha.</StateMessage>}
      {rows && <ul className="estoque__recipe">
        {rows.map((row) => {
          const ingredient = byId.get(row.ingredientId);
          return <li key={row.key}>
            <select aria-label="Insumo" value={row.ingredientId} disabled={busy} onChange={(event) => {
              const next = byId.get(event.target.value);
              update(row.key, { ingredientId: event.target.value, unit: next ? inputUnitOptions(next.unit).at(-1)!.id : "base" });
            }}>
              <option value="">Escolha o insumo</option>
              {active.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <input aria-label="Quantidade" inputMode="decimal" value={row.qty} disabled={busy || !ingredient} onChange={(event) => update(row.key, { qty: event.target.value })} />
            {ingredient && <select aria-label="Unidade" value={row.unit} disabled={busy} onChange={(event) => update(row.key, { unit: event.target.value as InputUnit })}>
              {inputUnitOptions(ingredient.unit).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>}
            <Button variant="quiet" icon="close" aria-label="Remover insumo" disabled={busy} onClick={() => setRows((current) => current?.filter((r) => r.key !== row.key) ?? null)} />
          </li>;
        })}
      </ul>}
      {rows && active.length > 0 && <Button icon="stock" disabled={busy} onClick={() => setRows((current) => [...(current ?? []), { key: ++seq.current, ingredientId: "", qty: "", unit: "base" }])}>Adicionar insumo</Button>}
      {owner && rows && <div className="estoque__recipe-total">
        <span>Custo estimado: <strong>{money(costCents)}</strong></span>
        {priceCents !== undefined && priceCents > 0 && <span>Preço {money(priceCents)} · CMV {((costCents * 100) / priceCents).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · margem <strong>{money(priceCents - costCents)}</strong></span>}
        {parsed.some((p) => p.ingredient && (p.ingredient.unitCostMillicents ?? 0) === 0) && <span className="estoque__hint">Insumo sem compra registrada entra com custo zero.</span>}
      </div>}
      {!owner && <p className="estoque__hint">Só o dono altera a ficha técnica.</p>}
      {error && <StateMessage tone="danger" title="Ficha não salva">{error}</StateMessage>}
      <div className="estoque__actions">
        <Button onClick={onClose} disabled={busy}>Fechar</Button>
        {owner && <Button type="submit" variant="primary" busy={busy} disabled={!rows}>Salvar ficha</Button>}
      </div>
      {parsed.length > 0 && <p className="estoque__hint">Consumo por unidade: {parsed.filter((p) => p.ingredient && p.quantity).map((p) => `${p.ingredient!.name} ${formatQty(p.quantity!, p.ingredient!.unit)}`).join(" · ") || "—"}</p>}
    </form>
  </Modal>;
}
