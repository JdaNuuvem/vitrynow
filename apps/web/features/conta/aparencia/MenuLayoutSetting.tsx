"use client";

import { useState } from "react";
import type { StoreSettings, StoreSettingsInput } from "@/core/domain/store";
import type { SaveMessage } from "../hooks/useConta";

// Modelo do cardápio público: lista clássica ou feed estilo Reels (um prato por tela, vídeo quando houver).
const OPTIONS = [
  { id: "CLASSIC", title: "Clássico", text: "Lista de categorias e pratos, com a faixa “Veja em vídeo” quando houver vídeos." },
  { id: "REELS", title: "Reels", text: "Um prato por tela, deslizando como no Instagram. Vídeo quando o prato tiver; foto com movimento quando não." },
] as const;

export function MenuLayoutSetting({ store, canEdit, onSave }: { store: StoreSettings; canEdit: boolean; onSave: (input: StoreSettingsInput) => Promise<SaveMessage> }) {
  const [value, setValue] = useState<"CLASSIC" | "REELS">(store.menuLayout ?? "CLASSIC");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const saved = store.menuLayout ?? "CLASSIC";

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await onSave({ menuLayout: value });
    setBusy(false);
    setMessage(result.kind === "ok" ? { kind: "ok", text: "Modelo salvo. O cardápio público pode levar alguns instantes para atualizar." } : result);
  }

  return (
    <section className="appearance__section appearance__layout-choice" aria-labelledby="appearance-layout">
      <h2 id="appearance-layout">Modelo do cardápio</h2>
      <div className="appearance__layout-options" role="radiogroup" aria-labelledby="appearance-layout">
        {OPTIONS.map((o) => (
          <label key={o.id} className="appearance__layout-option" data-selected={value === o.id}>
            <input type="radio" name="menuLayout" value={o.id} checked={value === o.id} disabled={!canEdit || busy} onChange={() => { setValue(o.id); setMessage(null); }} />
            <span><strong>{o.title}</strong><span>{o.text}</span></span>
          </label>
        ))}
      </div>
      {canEdit ? (
        <button type="button" className="ds-button ds-button--primary" disabled={busy || value === saved} onClick={() => void save()}>
          {busy ? "Salvando…" : "Salvar modelo"}
        </button>
      ) : null}
      {message ? <p className="appearance__feedback" role={message.kind === "ok" ? "status" : "alert"}>{message.text}</p> : null}
    </section>
  );
}
