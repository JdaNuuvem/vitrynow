"use client";

import { useState } from "react";
import { computeDifference } from "@/features/caixa/cashierSummary";
import { digitsToCents, formatCents } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";

type CloseCashCardProps = {
  expectedBalanceCents: number;
  onClose: (closingBalanceCents: number) => Promise<string | null>;
};

export function CloseCashCard({ expectedBalanceCents, onClose }: CloseCashCardProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const informedCents = digitsToCents(value);
  const difference = computeDifference(informedCents, expectedBalanceCents);

  async function submit() {
    setError(null);
    setError(await onClose(informedCents));
  }

  return (
    <div className="controlecaixa-card">
      <h2>Fechar caixa</h2>
      <label className="controlecaixa__label">Valor contado na gaveta</label>
      <MoneyInput name="closingBalance" value={value} onChange={setValue} />
      {value && (
        <p className={difference === 0 ? "controlecaixa__diff" : "controlecaixa__diff controlecaixa__diff--off"}>
          Diferença: {difference > 0 ? "+" : ""}
          {formatCents(difference)}
        </p>
      )}
      {error && <p className="controlecaixa__error">{error}</p>}
      <button type="button" className="controlecaixa__button controlecaixa__button--danger" onClick={submit}>
        Fechar caixa
      </button>
    </div>
  );
}
