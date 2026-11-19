"use client";

import { useId, useRef, useState } from "react";
import type { Deliverer } from "@/core/domain/orders";
import { Button, StateMessage } from "@/shared/design/components";
import { Modal } from "@/shared/ui/Modal";

export function NewDelivererForm({ initial, save, onClose }: {
  initial?: Deliverer;
  save: (name: string, phone: string, id?: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const title = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current || !name.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const failure = await save(name.trim(), phone.trim(), initial?.id);
      if (failure) setError(failure);
      else onClose();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <Modal open labelledBy={title} width={480} sheetOnMobile fitContent onClose={() => { if (!inFlight.current) onClose(); }}>
    <form className="entregadores__form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id={title}>{initial ? "Editar entregador" : "Novo entregador"}</h2>
      <label>Nome<input required maxLength={80} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <label>Telefone (opcional)<input type="tel" autoComplete="tel" value={phone} maxLength={20} disabled={busy} onChange={(event) => setPhone(event.target.value)} /></label>
      {initial?.phone && <p className="entregadores__hint">Em branco, o telefone atual é mantido.</p>}
      {error && <StateMessage tone="danger" title="Entregador não salvo">{error}</StateMessage>}
      <div className="entregadores__actions">
        <Button onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" variant="primary" busy={busy}>{initial ? "Salvar alterações" : "Adicionar entregador"}</Button>
      </div>
    </form>
  </Modal>;
}
