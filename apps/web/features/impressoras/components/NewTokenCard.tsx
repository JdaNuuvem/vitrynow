"use client";

import { useState } from "react";
import type { CreateOutcome } from "../hooks/useImpressoras";

export function NewTokenCard({ onCreate }: { onCreate: (label: string) => Promise<CreateOutcome> }) {
  const [label, setLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const outcome = await onCreate(label);
    if (outcome.status === "error") return setError(outcome.message);
    if (outcome.status === "created") {
      setNewToken(outcome.token);
      setLabel("");
    }
  }

  return (
    <div className="impressoras-card">
      <h2>Nova chave</h2>
      <input aria-label="Identificação da chave" placeholder="Identificação (ex.: PC do balcão)" value={label} onChange={(event) => setLabel(event.target.value)} />
      {error && (
        <p role="alert" className="impressoras__error">
          {error}
        </p>
      )}
      <button type="button" className="impressoras__button" onClick={submit}>
        Gerar chave
      </button>
      {newToken && (
        <div className="impressoras-card__token">
          <p>Copie agora — cole essa chave na tela de configuração do print-client:</p>
          <code>{newToken}</code>
        </div>
      )}
    </div>
  );
}
