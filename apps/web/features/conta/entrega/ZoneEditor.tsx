import { useState, type FormEvent } from "react";
import type { DeliveryZone, ZoneFields } from "@/core/gateways/DeliveryZonesGateway";
import { digitsToCents, maskMoneyInput } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { Modal } from "@/shared/ui/Modal";

export function ZoneEditor({ zone, busy, error, onClose, onSave }: {
  zone?: DeliveryZone;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (fields: ZoneFields) => void;
}) {
  const [name, setName] = useState(zone?.name ?? "");
  const [fee, setFee] = useState(maskMoneyInput(String(zone?.feeCents ?? 0)));
  const [minimum, setMinimum] = useState(zone?.etaMinMinutes?.toString() ?? "");
  const [maximum, setMaximum] = useState(zone?.etaMaxMinutes?.toString() ?? "");
  const [threshold, setThreshold] = useState(maskMoneyInput(zone?.freeFromCents?.toString() ?? ""));
  const [active, setActive] = useState(zone?.active ?? true);
  const [validation, setValidation] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setValidation("Informe o nome do bairro.");
    if (minimum && maximum && Number(minimum) > Number(maximum)) return setValidation("O prazo mínimo supera o máximo.");
    if (!fee || digitsToCents(fee) > 10_000_000) return setValidation("Informe uma taxa de até R$ 100.000,00.");
    if (threshold && (digitsToCents(threshold) <= 0 || digitsToCents(threshold) > 100_000_000)) return setValidation("Informe um limite de frete grátis válido ou deixe em branco.");
    setValidation("");
    onSave({ name: name.trim(), active, feeCents: digitsToCents(fee),
      etaMinMinutes: minimum ? Number(minimum) : null, etaMaxMinutes: maximum ? Number(maximum) : null,
      freeFromCents: threshold ? digitsToCents(threshold) : null });
  }
  return (
    <Modal open onClose={onClose} labelledBy="zone-editor-title" width={490} sheetOnMobile>
      <form className="zones-editor" onSubmit={submit}>
        <h2 id="zone-editor-title">{zone ? "Editar bairro" : "Adicionar bairro"}</h2>
        <fieldset disabled={busy}>
          <label>Nome do bairro<input value={name} onChange={e => setName(e.target.value)} maxLength={100} required /></label>
          <label>Taxa de entrega<MoneyInput name="zone-fee" value={fee} onChange={setFee} /></label>
          <div className="zones-editor__pair">
            <label>Prazo mínimo (min)<input type="number" min={1} max={1440} value={minimum} onChange={e => setMinimum(e.target.value)} /></label>
            <label>Prazo máximo (min)<input type="number" min={1} max={1440} value={maximum} onChange={e => setMaximum(e.target.value)} /></label>
          </div>
          <label>Frete grátis a partir de (opcional)<MoneyInput name="zone-free-from" value={threshold} onChange={setThreshold} /></label>
          <label className="zones-editor__check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Atender este bairro</label>
        </fieldset>
        {(validation || error) && <p role="alert">{validation || error}</p>}
        <div className="zones-actions">
          <button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="zones-primary" disabled={busy}>Salvar bairro</button>
        </div>
      </form>
    </Modal>
  );
}
