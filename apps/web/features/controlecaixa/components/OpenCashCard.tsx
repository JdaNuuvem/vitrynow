"use client";

import { useState } from "react";
import { digitsToCents } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";

export function OpenCashCard({ onOpen }: { onOpen: (openingBalanceCents: number) => Promise<string | null> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setError(await onOpen(digitsToCents(value)));
  }

  return (
    <div className="controlecaixa-card controlecaixa-card--narrow">
      <p className="controlecaixa__muted">Nenhum caixa aberto.</p>
      <label className="controlecaixa__label">Valor de abertura</label>
      <MoneyInput name="openingBalance" value={value} onChange={setValue} />
      {error && <p className="controlecaixa__error">{error}</p>}
      <button type="button" className="controlecaixa__button" onClick={submit}>
        Abrir caixa
      </button>
    </div>
  );
}
