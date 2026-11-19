"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { digitsToCents } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { Button, Field, Panel, StateMessage } from "@/shared/design/components";

export function OpenCashCard({ onOpen }: { onOpen: (openingBalanceCents: number, notes?: string) => Promise<string | null> }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const cents = digitsToCents(value);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value || cents > 100_000_000 || pending.current) return;
    pending.current = true;
    setError(null);
    setBusy(true);
    try {
      setError(await onOpen(cents, notes.trim() || undefined));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Panel title="Abrir caixa" className="controlecaixa-card--narrow">
      <form className="cash-edit" onSubmit={submit}>
        <div className="cash-edit__money">
          <label htmlFor={id + "-abertura"}>Saldo inicial em dinheiro</label>
          <MoneyInput id={id + "-abertura"} name="openingBalance" value={value} onChange={setValue} />
        </div>
        <Field id={id + "-observacao"} label="Observação (opcional)">
          <textarea id={id + "-observacao"} rows={2} value={notes} maxLength={300} onChange={(event) => setNotes(event.target.value)} />
        </Field>
        {error && <StateMessage tone="danger" title={error} />}
        <Button variant="primary" type="submit" busy={busy} disabled={!value || cents > 100_000_000}>Abrir caixa</Button>
      </form>
    </Panel>
  );
}
