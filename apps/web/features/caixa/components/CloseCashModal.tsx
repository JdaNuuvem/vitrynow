"use client";

import { useState } from "react";
import type { CashSummary } from "@/core/domain/cashier";
import { digitsToCents, formatCents } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { computeDifference } from "../cashierSummary";
import { CashModalLayout } from "./CashModalLayout";

type CloseCashModalProps = {
  open: boolean;
  summary: CashSummary | null;
  onClose: () => void;
  onShowHistory: () => void;
  onConfirm: (closingBalanceCents: number, notes: string) => Promise<string | null>;
};

function Row({ label, value, bold, children }: { label: string; value: string; bold?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`cash-row${bold ? " cash-row--bold" : ""}`}>
      <p>
        {label}
        {children}
      </p>
      <p>{value}</p>
    </div>
  );
}

export function CloseCashModal({ open, summary, onClose, onShowHistory, onConfirm }: CloseCashModalProps) {
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!summary) return null;
  const informed = value ? digitsToCents(value) : null;

  async function submit() {
    if (informed === null) return;
    setSubmitting(true);
    const failure = await onConfirm(informed, notes.trim());
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
      title="Fechar caixa"
      titleId="close-cash-title"
      error={error}
      footer={
        <>
          <button type="button" className="cash-modal__primary" disabled={informed === null || submitting} onClick={submit}>
            Fechar caixa
          </button>
          <button type="button" className="cash-modal__cancel" onClick={onClose}>
            Cancelar
          </button>
        </>
      }
    >
      <div className="cash-modal__summary">
        <div className="cash-modal__summary-title">
          <p>Movimentação do caixa</p>
          <p>Saldo de abertura + vendas em dinheiro + entradas - saídas.</p>
        </div>
        <Row label="Saldo abertura:" value={formatCents(summary.openingCents)} />
        <Row label="Vendas em dinheiro:" value={formatCents(summary.cashSalesCents)} />
        <Row label="Entradas:" value={formatCents(summary.entriesCents)} />
        <Row label="Saídas:" value={formatCents(summary.exitsCents)}>
          <button type="button" className="cash-link" onClick={onShowHistory}>
            Histórico
          </button>
        </Row>
        <Row label="Em caixa esperado:" value={formatCents(summary.expectedCents)} bold />
        <Row label="Em caixa informado:" value={informed === null ? "Não informado" : formatCents(informed)} />
        <Row
          label="Diferença:"
          value={informed === null ? "Não calculada" : formatCents(computeDifference(informed, summary.expectedCents))}
        />
      </div>
      <div className="cash-modal__info">Informe o valor final no caixa em dinheiro</div>
      <div className="cash-modal__field">
        <MoneyInput name="closingBalance" value={value} onChange={setValue} autoFocus />
      </div>
      <div className="cash-modal__field">
        <p>Observação</p>
        <textarea placeholder="Insira detalhes sobre esta operação" maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
    </CashModalLayout>
  );
}
