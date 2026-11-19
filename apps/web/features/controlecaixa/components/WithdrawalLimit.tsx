"use client";

import { useId, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/core/http/FetchHttpClient";
import { Button, Panel, StateMessage } from "@/shared/design/components";
import { digitsToCents, maskMoneyInput } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";

export function WithdrawalLimit({ currentCents, onSaved }: { currentCents: number; onSaved: () => void }) {
  const id = useId();
  const [value, setValue] = useState(() => maskMoneyInput(String(currentCents)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const cents = digitsToCents(value);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !value || cents > 100_000_000 || cents === currentCents) return;
    setBusy(true);
    setMessage(null);
    const result = await apiFetch("/api/cashier/staff-withdrawal-limit", {
      method: "PUT", body: JSON.stringify({ limitCents: cents }),
    });
    if (result.ok) {
      setMessage({ ok: true, text: "Limite atualizado." });
      onSaved();
    } else {
      setMessage({ ok: false, text: extractErrorMessage(await result.json().catch(() => null)) });
    }
    setBusy(false);
  }

  return (
    <Panel title="Limite de sangria">
      <form className="cash-edit" onSubmit={submit}>
        <div className="cash-edit__money">
          <label htmlFor={id}>Limite total da equipe por caixa aberto</label>
          <MoneyInput id={id} name="staffWithdrawalLimit" value={value} onChange={setValue} />
        </div>
        {message && <StateMessage tone={message.ok ? "success" : "danger"} title={message.text} />}
        <Button variant="primary" type="submit" busy={busy} disabled={!value || cents === currentCents || cents > 100_000_000}>Salvar limite</Button>
      </form>
    </Panel>
  );
}
