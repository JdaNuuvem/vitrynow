"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button, Field, Panel } from "@/shared/design/components";
import type { CreateOutcome } from "../hooks/useImpressoras";

export function NewTokenCard({ onCreate }: { onCreate: (label: string) => Promise<CreateOutcome> }) {
  const [label, setLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const creating = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating.current) return;
    creating.current = true;
    setError(null);
    setBusy(true);
    const outcome = await onCreate(label.trim());
    creating.current = false;
    setBusy(false);
    if (outcome.status === "error") return setError(outcome.message);
    if (outcome.status === "created") {
      setNewToken(outcome.token);
      setCopyStatus("");
      setLabel("");
    }
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopyStatus("Chave copiada.");
    } catch {
      setCopyStatus("Selecione e copie a chave manualmente.");
    }
  }

  return (
    <Panel title="Nova chave">
      <form className="print-settings__section" onSubmit={submit}>
        <Field id="printer-key-label" label="Identificação da chave" hint="Opcional. Use uma chave por computador com impressora." error={error ?? undefined}>
          <input id="printer-key-label" placeholder="Ex.: PC do balcão" value={label} maxLength={100}
            aria-invalid={Boolean(error)} aria-describedby={error ? "printer-key-label-hint printer-key-label-error" : "printer-key-label-hint"}
            onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Button type="submit" variant="primary" busy={busy}>Gerar chave</Button>
      </form>
      {newToken && (
        <div className="impressoras-card__token">
          <p>A chave aparece uma vez. Cole o código na configuração do print-client.</p>
          <code>{newToken}</code>
          <div className="print-settings__actions">
            <Button onClick={() => void copyToken()}>Copiar chave</Button>
            <Button variant="quiet" onClick={() => { setNewToken(null); setCopyStatus(""); }}>Ocultar chave</Button>
          </div>
          {copyStatus && <p role="status">{copyStatus}</p>}
        </div>
      )}
    </Panel>
  );
}
