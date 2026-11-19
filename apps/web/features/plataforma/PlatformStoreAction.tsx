"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/shared/design/components";
import { Modal } from "@/shared/ui/Modal";
import { platformApi, type StoreAction } from "./platformApi";
import { usePlatform } from "./PlatformShell";

const actions: Record<StoreAction, { title: string; confirm: string }> = {
  suspend: { title: "Suspender loja", confirm: "Suspender loja" },
  reactivate: { title: "Reativar loja", confirm: "Reativar loja" },
  "extend-trial": { title: "Estender período de teste", confirm: "Estender período" },
};

export function PlatformStoreAction({ storeId, name, action, onClose, onDone }: {
  storeId: string; name: string; action: StoreAction; onClose: () => void; onDone: (label: string) => void;
}) {
  const { request } = usePlatform();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const running = useRef(false);
  const close = () => { if (!running.current) onClose(); };
  const copy = actions[action];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current || uncertain) return;
    const fields = new FormData(event.currentTarget);
    const reason = String(fields.get("reason") ?? "").trim();
    if (reason.length < 5) return setError("Informe um motivo com pelo menos cinco caracteres.");
    running.current = true;
    setBusy(true);
    setError(null);
    const result = await request(() => platformApi.changeStore(storeId, action, reason, Number(fields.get("days"))));
    setBusy(false);
    running.current = false;
    if (result.ok) {
      onDone(action === "extend-trial" ? "Período de teste estendido." : action === "suspend" ? "Loja suspensa." : "Loja reativada.");
    } else if (result.status >= 500 || result.status === 409) {
      setUncertain(true);
      setError(result.status === 409 ? result.error : "A operação não foi confirmada. Confira a situação atual da loja antes de tentar novamente.");
    } else setError(result.error);
  }

  return <Modal open onClose={close} labelledBy="platform-store-action-title" width={500} closeOnScrim={false}>
    <form className="platform-dialog platform-form" onSubmit={submit}>
      <header><h2 id="platform-store-action-title">{copy.title}</h2><p>{name}</p></header>
      {action === "suspend" && <p>Enquanto estiver suspensa pela plataforma, a loja para de receber novos pedidos.</p>}
      {action === "extend-trial" && <label className="platform-field">Dias adicionais
        <input name="days" type="number" min={1} max={60} step={1} defaultValue={7} required disabled={busy || uncertain} />
      </label>}
      <label className="platform-field">Motivo
        <textarea name="reason" minLength={5} maxLength={300} rows={3} required disabled={busy || uncertain} />
      </label>
      {error && <p className="platform-message platform-message--error" role="alert">{error}</p>}
      <div className="platform-actions">
        <Button type="button" onClick={() => uncertain ? onDone("") : close()} disabled={busy}>{uncertain ? "Atualizar situação" : "Cancelar"}</Button>
        {!uncertain && <Button variant={action === "suspend" ? "danger" : "primary"} type="submit" busy={busy}>{busy ? "Processando…" : copy.confirm}</Button>}
      </div>
    </form>
  </Modal>;
}
