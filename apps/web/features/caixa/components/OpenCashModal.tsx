"use client";

import { useState } from "react";
import { digitsToCents } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { CashModalLayout } from "./CashModalLayout";

type OpenCashModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (openingBalanceCents: number, notes: string) => Promise<string | null>;
};

export function OpenCashModal({ open, onClose, onConfirm }: OpenCashModalProps) {
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    const failure = await onConfirm(digitsToCents(value), notes.trim());
    setSubmitting(false);
    if (failure) return setError(failure);
    setValue("");
    setNotes("");
    setError(null);
    onClose();
  }

  return (
    <CashModalLayout
      open={open}
      onClose={onClose}
      title="Abrir caixa"
      titleId="open-cash-title"
      info="Informe o saldo no momento da abertura."
      error={error}
      footer={
        <>
          <button type="button" className="cash-modal__primary" disabled={!value || submitting} onClick={submit}>
            Abrir caixa
          </button>
          <button type="button" className="cash-modal__cancel" onClick={onClose}>
            Cancelar
          </button>
        </>
      }
    >
      <div className="cash-modal__field">
        <h5>Saldo em dinheiro</h5>
        <MoneyInput name="openingBalance" value={value} onChange={setValue} autoFocus />
      </div>
      <div className="cash-modal__field">
        <p>Observação</p>
        <textarea placeholder="Insira detalhes sobre esta operação" maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
    </CashModalLayout>
  );
}
