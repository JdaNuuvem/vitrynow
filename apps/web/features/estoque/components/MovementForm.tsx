"use client";

import { useId, useRef, useState } from "react";
import { formatQty, LOSS_NOTE_MAX, SPOILAGE_REASONS, WASTE_REASONS, type Ingredient } from "@/core/domain/stock";
import type { StockGateway } from "@/core/gateways/StockGateway";
import type { HttpResult } from "@/core/http/HttpClient";
import { Button, StateMessage } from "@/shared/design/components";
import { digitsToCents, maskMoneyInput } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { Modal } from "@/shared/ui/Modal";
import { inputUnitOptions, toBaseQty, type InputUnit } from "../quantity";

export type MovementKind = "purchase" | "loss" | "count";

const TITLE: Record<MovementKind, string> = { purchase: "Registrar compra", loss: "Registrar perda", count: "Contagem de estoque" };

// Compra (entra com o valor pago: a API recalcula o custo médio), perda (desperdício ou estragado, com motivo de lista fechada)
// e contagem (só o dono: o saldo vira o contado e a diferença fica registrada como ajuste).
export function MovementForm({ kind, ingredient, gateway, run, onClose }: {
  kind: MovementKind;
  ingredient: Ingredient;
  gateway: StockGateway;
  run: (action: () => Promise<HttpResult<unknown>>) => Promise<string | null>;
  onClose: () => void;
}) {
  const title = useId();
  const units = inputUnitOptions(ingredient.unit);
  const [qtyUnit, setQtyUnit] = useState<InputUnit>(units[0].id);
  const [qty, setQty] = useState("");
  const [total, setTotal] = useState(maskMoneyInput(""));
  const [lossType, setLossType] = useState<"WASTE" | "SPOILAGE">("WASTE");
  const [reason, setReason] = useState<string>("PREPARO");
  const [note, setNote] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const reasons = lossType === "WASTE" ? WASTE_REASONS : SPOILAGE_REASONS;

  async function submit() {
    if (inFlight.current) return;
    const quantity = toBaseQty(qty, ingredient.unit, qtyUnit);
    if (quantity === null || (kind !== "count" && quantity <= 0)) return setError("Informe uma quantidade válida.");
    if (kind === "loss" && reason === "OUTRO" && !note.trim()) return setError("Escreva a observação do motivo Outro.");
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const failure = await run(() =>
        kind === "purchase" ? gateway.purchase(ingredient.id, { quantity, totalCostCents: digitsToCents(total), ...(expiresOn ? { expiresOn } : {}) })
          : kind === "loss" ? gateway.loss(ingredient.id, { type: lossType, quantity, reason, ...(note.trim() ? { note: note.trim() } : {}) })
            : gateway.count(ingredient.id, quantity));
      if (failure) setError(failure);
      else onClose();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <Modal open labelledBy={title} width={480} sheetOnMobile fitContent onClose={() => { if (!inFlight.current) onClose(); }}>
    <form className="estoque__form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id={title}>{TITLE[kind]}</h2>
      <p className="estoque__hint"><strong>{ingredient.name}</strong> · saldo atual {formatQty(ingredient.stockQty, ingredient.unit)}</p>
      {kind === "loss" && <>
        <fieldset className="estoque__segmented">
          <legend>Tipo de perda</legend>
          <label><input type="radio" name="lossType" checked={lossType === "WASTE"} onChange={() => { setLossType("WASTE"); setReason("PREPARO"); }} /> Desperdício no preparo</label>
          <label><input type="radio" name="lossType" checked={lossType === "SPOILAGE"} onChange={() => { setLossType("SPOILAGE"); setReason("VENCIDO"); }} /> Estragou ou venceu</label>
        </fieldset>
        <label>Motivo
          <select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)}>
            {Object.entries(reasons).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>Observação{reason === "OUTRO" ? "" : " (opcional)"}
          <input value={note} maxLength={LOSS_NOTE_MAX} required={reason === "OUTRO"} disabled={busy} onChange={(event) => setNote(event.target.value)} />
        </label>
      </>}
      <div className="estoque__qty">
        <label>{kind === "count" ? "Quantidade contada" : kind === "purchase" ? "Quantidade comprada" : "Quantidade perdida"}
          <input required inputMode="decimal" autoFocus value={qty} disabled={busy} onChange={(event) => setQty(event.target.value)} />
        </label>
        <select aria-label="Unidade" value={qtyUnit} disabled={busy} onChange={(event) => setQtyUnit(event.target.value as InputUnit)}>
          {units.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {kind === "purchase" && <label>Valor total pago<MoneyInput name="total" value={total} onChange={setTotal} /></label>}
      {kind === "purchase" && <label>Validade do lote (opcional)<input type="date" value={expiresOn} disabled={busy} onChange={(event) => setExpiresOn(event.target.value)} /></label>}
      {kind === "purchase" && <p className="estoque__hint">O custo do insumo é recalculado pela média ponderada com o estoque atual.</p>}
      {kind === "count" && <p className="estoque__hint">O saldo passa a ser o contado. Sobra ou falta fica registrada como ajuste de contagem.</p>}
      {error && <StateMessage tone="danger" title="Lançamento não registrado">{error}</StateMessage>}
      <div className="estoque__actions">
        <Button onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" variant="primary" busy={busy}>Registrar</Button>
      </div>
    </form>
  </Modal>;
}
