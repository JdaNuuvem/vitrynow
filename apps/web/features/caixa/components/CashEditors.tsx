"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { CashCloseInput, CashClosingPreview, CashMovementInput, CashMovementType } from "@/core/domain/cashier";
import type { HttpResult } from "@/core/http/HttpClient";
import { Button, Field, StateMessage } from "@/shared/design/components";
import { digitsToCents, formatCents } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { closeReasons, movementReasons } from "../cashReasons";
import "./cash-editors.css";

const maxCents = 100_000_000;
type Failure = Promise<string | null>;

function ReasonField({ id, reason, onChange, reasonText, setReasonText, choices, required }: {
  id: string; reason: string; onChange: (reason: string) => void; reasonText: string; setReasonText: (text: string) => void;
  choices: readonly (readonly [string, string])[]; required: boolean;
}) {
  return (
    <>
      <Field id={id} label={required ? "Motivo" : "Motivo (opcional)"}>
        <select id={id} required={required} value={reason} onChange={(event) => onChange(event.target.value)}>
          <option value="">{required ? "Selecione" : "Sem motivo informado"}</option>
          {choices.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </Field>
      {reason === "OUTRO" && <Field id={id + "-outro"} label="Descreva o motivo">
        <input id={id + "-outro"} value={reasonText} maxLength={200} required onChange={(event) => setReasonText(event.target.value)} />
      </Field>}
    </>
  );
}

export function CashMovementEditor({ fixedType, onConfirm, onSuccess }: {
  fixedType?: CashMovementType; onConfirm: (input: CashMovementInput, key: string) => Failure; onSuccess?: () => void;
}) {
  const id = useId();
  const [type, setType] = useState<CashMovementType>(fixedType ?? "SUPRIMENTO");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const submitting = useRef(false);
  const amountCents = digitsToCents(amount);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !reason || amountCents <= 0 || amountCents > maxCents) return;
    const input: CashMovementInput = { type, amountCents, reason, reasonText: reason === "OUTRO" ? reasonText.trim() : undefined, notes: notes.trim() || undefined };
    if (reason === "OUTRO" && !input.reasonText) return setMessage({ error: true, text: "Descreva o motivo." });
    const signature = JSON.stringify(input);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    submitting.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const failure = await onConfirm(input, request.current.key);
      if (failure) return setMessage({ error: true, text: failure });
      request.current = null;
      setAmount(""); setReason(""); setReasonText(""); setNotes("");
      setMessage({ error: false, text: "Movimentação registrada." });
      onSuccess?.();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="cash-edit" onSubmit={submit}>
      <fieldset disabled={busy} className="cash-edit__fields">
        {!fixedType && <Field id={id + "-tipo"} label="Tipo">
          <select id={id + "-tipo"} value={type} onChange={(event) => { setType(event.target.value === "SANGRIA" ? "SANGRIA" : "SUPRIMENTO"); setReason(""); setReasonText(""); }}>
            <option value="SUPRIMENTO">Suprimento (entrada)</option><option value="SANGRIA">Sangria (saída)</option>
          </select>
        </Field>}
        <div className="cash-edit__money">
          <label htmlFor={id + "-valor"}>Valor</label>
          <MoneyInput name="movementAmount" id={id + "-valor"} value={amount} onChange={setAmount} />
        </div>
        <ReasonField id={id + "-motivo"} reason={reason} onChange={setReason} reasonText={reasonText} setReasonText={setReasonText} choices={movementReasons[type]} required />
        <Field id={id + "-observacao"} label="Observação (opcional)">
          <textarea id={id + "-observacao"} rows={2} maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </fieldset>
      {message && <StateMessage tone={message.error ? "danger" : "success"} title={message.text} />}
      <Button variant="primary" type="submit" busy={busy} disabled={amountCents <= 0 || amountCents > maxCents || !reason}>Registrar movimentação</Button>
    </form>
  );
}

export function CashCloseEditor({ onPreview, onConfirm, onSuccess }: {
  onPreview: (amount: number) => Promise<HttpResult<CashClosingPreview>>;
  onConfirm: (input: CashCloseInput) => Failure;
  onSuccess?: () => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<CashClosingPreview | null>(null);
  const [reason, setReason] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const cents = digitsToCents(amount);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !amount || cents > maxCents) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!preview) {
        const result = await onPreview(cents);
        if (!result.ok) return setError(result.error);
        setPreview(result.data);
        return;
      }
      if (reason === "OUTRO" && !reasonText.trim()) return setError("Descreva o motivo.");
      const failure = await onConfirm({
        closingBalanceCents: cents, sessionId: preview.sessionId, expectedBalanceCents: preview.expectedCents,
        reason: reason || undefined, reasonText: reason === "OUTRO" ? reasonText.trim() : undefined, notes: notes.trim() || undefined,
      });
      if (failure) {
        setPreview(null);
        return setError(failure);
      }
      onSuccess?.();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="cash-edit" onSubmit={submit}>
      <fieldset disabled={busy} className="cash-edit__fields">
        <div className="cash-edit__money">
          <label htmlFor={id + "-contado"}>Valor contado na gaveta</label>
          <MoneyInput name="closingBalance" id={id + "-contado"} value={amount} onChange={(value) => { setAmount(value); setPreview(null); setError(null); }} />
        </div>
        {preview && (
          <>
            <dl className="cash-edit__preview" aria-label="Prévia do fechamento">
              <div><dt>Esperado</dt><dd>{formatCents(preview.expectedCents)}</dd></div>
              <div><dt>Contado</dt><dd>{formatCents(preview.countedCents)}</dd></div>
              <div><dt>{preview.differenceCents < 0 ? "Faltou" : preview.differenceCents > 0 ? "Sobrou" : "Diferença"}</dt>
                <dd>{formatCents(Math.abs(preview.differenceCents))}</dd></div>
            </dl>
            <ReasonField id={id + "-motivo"} reason={reason} onChange={setReason} reasonText={reasonText} setReasonText={setReasonText} choices={closeReasons} required={preview.reasonRequired} />
            <Field id={id + "-observacao"} label="Observação (opcional)">
              <textarea id={id + "-observacao"} rows={2} maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </>
        )}
      </fieldset>
      {error && <StateMessage tone="danger" title={error} />}
      <Button variant={preview ? "danger" : "primary"} type="submit" busy={busy} disabled={!amount || cents > maxCents}>
        {preview ? "Fechar caixa" : "Conferir valores"}
      </Button>
    </form>
  );
}
