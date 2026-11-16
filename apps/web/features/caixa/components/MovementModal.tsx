"use client";

import { useState } from "react";
import type { CashMovementType } from "@/core/domain/cashier";
import { digitsToCents } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { CashModalLayout } from "./CashModalLayout";

const COPY: Record<CashMovementType, { title: string; info: string }> = {
  SUPRIMENTO: { title: "Entrada de dinheiro", info: "Informe o valor que está entrando no caixa." },
  SANGRIA: { title: "Saída de dinheiro", info: "Informe o valor que está saindo do caixa." },
};

type MovementModalProps = {
  type: CashMovementType | null;
  onClose: () => void;
  onConfirm: (type: CashMovementType, amountCents: number, notes: string) => Promise<string | null>;
};

export function MovementModal({ type, onClose, onConfirm }: MovementModalProps) {
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const amountCents = digitsToCents(value);
  const canSubmit = amountCents > 0 && notes.trim().length > 0 && !submitting;

  async function submit() {
    if (!type) return;
    setSubmitting(true);
    const failure = await onConfirm(type, amountCents, notes.trim());
    setSubmitting(false);
    if (failure) return setError(failure);
    setValue("");
    setNotes("");
    setError(null);
    onClose();
  }

  const copy = type ? COPY[type] : COPY.SUPRIMENTO;

  return (
    <CashModalLayout
      open={type !== null}
      onClose={onClose}
      title={copy.title}
      titleId="movement-title"
      info={copy.info}
      error={error}
      footer={
        <>
          <button type="button" className="cash-modal__primary" disabled={!canSubmit} onClick={submit}>
            Confirmar operação
          </button>
          <button type="button" className="cash-modal__cancel" onClick={onClose}>
            Cancelar
          </button>
        </>
      }
    >
      <div className="cash-modal__field">
        <MoneyInput name="amount" value={value} onChange={setValue} autoFocus />
      </div>
      <div className="cash-modal__field">
        <p>
          Observação <span>(Obrigatório)</span>
        </p>
        <textarea placeholder="Insira detalhes sobre esta operação" maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
    </CashModalLayout>
  );
}
