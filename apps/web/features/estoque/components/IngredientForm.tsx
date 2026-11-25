"use client";

import { useId, useRef, useState } from "react";
import { BIG_UNIT, UNIT_LABEL, type Ingredient, type StockUnit } from "@/core/domain/stock";
import { Button, StateMessage } from "@/shared/design/components";
import { Modal } from "@/shared/ui/Modal";
import { inputUnitOptions, toBaseQty, type InputUnit } from "../quantity";

// Cadastro e edição de insumo (só o dono). A unidade não muda depois de criado: o histórico inteiro está nela.
export function IngredientForm({ initial, onSave, onClose }: {
  initial?: Ingredient;
  onSave: (input: { name: string; unit: StockUnit; minStockQty: number | null; active?: boolean }) => Promise<string | null>;
  onClose: () => void;
}) {
  const title = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState<StockUnit>(initial?.unit ?? "G");
  const big = BIG_UNIT[unit];
  const [minUnit, setMinUnit] = useState<InputUnit>(big ? "big" : "base");
  const [min, setMin] = useState(initial?.minStockQty != null ? String(big && minUnit === "big" ? initial.minStockQty / big.factor : initial.minStockQty).replace(".", ",") : "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current || !name.trim()) return;
    const minStockQty = min.trim() ? toBaseQty(min, unit, minUnit) : null;
    if (min.trim() && minStockQty === null) return setError("Estoque mínimo inválido.");
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const failure = await onSave({ name: name.trim(), unit, minStockQty, ...(initial ? { active } : {}) });
      if (failure) setError(failure);
      else onClose();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <Modal open labelledBy={title} width={480} sheetOnMobile fitContent onClose={() => { if (!inFlight.current) onClose(); }}>
    <form className="estoque__form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id={title}>{initial ? "Editar insumo" : "Novo insumo"}</h2>
      <label>Nome<input required maxLength={80} value={name} disabled={busy} placeholder="Ex.: Carne moída, Pão brioche" onChange={(event) => setName(event.target.value)} /></label>
      <label>Unidade de controle
        <select value={unit} disabled={busy || !!initial} onChange={(event) => { const next = event.target.value as StockUnit; setUnit(next); setMinUnit(BIG_UNIT[next] ? "big" : "base"); }}>
          <option value="G">Peso (gramas / kg)</option>
          <option value="ML">Volume (ml / litros)</option>
          <option value="UN">Unidade (peças)</option>
        </select>
      </label>
      {initial && <p className="estoque__hint">A unidade não muda depois do cadastro: todo o histórico do insumo está nela ({UNIT_LABEL[unit]}).</p>}
      <div className="estoque__qty">
        <label>Estoque mínimo (opcional)<input inputMode="decimal" value={min} disabled={busy} placeholder="Avisa quando ficar abaixo" onChange={(event) => setMin(event.target.value)} /></label>
        <select aria-label="Unidade do estoque mínimo" value={minUnit} disabled={busy} onChange={(event) => setMinUnit(event.target.value as InputUnit)}>
          {inputUnitOptions(unit).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {initial && <label className="estoque__check"><input type="checkbox" checked={active} disabled={busy} onChange={(event) => setActive(event.target.checked)} /> Insumo ativo</label>}
      {error && <StateMessage tone="danger" title="Insumo não salvo">{error}</StateMessage>}
      <div className="estoque__actions">
        <Button onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" variant="primary" busy={busy}>{initial ? "Salvar alterações" : "Cadastrar insumo"}</Button>
      </div>
    </form>
  </Modal>;
}
