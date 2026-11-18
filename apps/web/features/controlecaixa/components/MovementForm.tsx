"use client";

import { useState } from "react";
import type { CashMovementType } from "@/core/domain/cashier";
import { digitsToCents } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";

type MovementFormProps = {
  onAdd: (type: CashMovementType, amountCents: number, notes: string) => Promise<string | null>;
};

export function MovementForm({ onAdd }: MovementFormProps) {
  const [type, setType] = useState<CashMovementType>("SUPRIMENTO");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const failure = await onAdd(type, digitsToCents(amount), notes);
    if (failure) return setError(failure);
    setAmount("");
    setNotes("");
  }

  return (
    <div className="controlecaixa-card">
      <h2>Nova movimentação</h2>
      <div className="controlecaixa__row">
        <select value={type} onChange={(event) => setType(event.target.value as CashMovementType)} aria-label="Tipo">
          <option value="SUPRIMENTO">Suprimento (entrada)</option>
          <option value="SANGRIA">Sangria (saída)</option>
        </select>
        <MoneyInput name="movementAmount" value={amount} onChange={setAmount} />
      </div>
      <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observação (opcional)" />
      {error && <p className="controlecaixa__error">{error}</p>}
      <button type="button" className="controlecaixa__button" onClick={submit}>
        Registrar
      </button>
    </div>
  );
}
