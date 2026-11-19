"use client";

import { useRef, useState, type FormEvent } from "react";
import type { OrderDetail } from "@/core/domain/orderDetail";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";
import { Button, Field, StateMessage, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { Modal } from "@/shared/ui/Modal";

const http = new FetchHttpClient();
const reasons = [
  ["DEVOLVIDO_NO_APP_MP", "Valor devolvido pelo aplicativo do Mercado Pago"],
  ["CONTA_ANTIGA", "Valor devolvido por uma conta antiga"],
  ["OUTRO", "Outro motivo"],
] as const;

export function ManualRefundAction({ order, onRegistered }: { order: OrderDetail; onRegistered: () => void }) {
  const { runProtected } = useSecurityConfirm();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!acknowledged || !reasons.some(([key]) => key === code) || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await runProtected("refund", (options) => http.post(
        "/api/orders/" + encodeURIComponent(order.id) + "/refund/manual", { code }, options,
      ));
      if (!result.ok) return setError(result.error);
      setOpen(false);
      onRegistered();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="pedido-refund">
      <Button variant="quiet" onClick={() => { setCode(""); setAcknowledged(false); setError(""); setOpen(true); }}>
        Registrar estorno externo
      </Button>
      <Modal open={open} onClose={() => { if (!sending.current) setOpen(false); }} labelledBy="refund-manual-title" width={500} fitContent sheetOnMobile>
        <form className="pedido-refund__form" onSubmit={submit}>
          <h2 id="refund-manual-title">Registrar estorno externo</h2>
          <p>Registre a devolução de {formatCents(order.payment?.amountCents ?? 0)} já concluída no Mercado Pago.</p>
          <Field id="refund-manual-reason" label="Motivo">
            <select id="refund-manual-reason" required value={code} disabled={busy} onChange={(event) => setCode(event.target.value)}>
              <option value="">Selecione</option>{reasons.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
            </select>
          </Field>
          <label className="pedido-refund__check"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} required />
            Confirmei a devolução no Mercado Pago.</label>
          {error && <StateMessage tone="danger" title={error} />}
          <div className="pedido-refund__actions">
            <Button onClick={() => setOpen(false)} disabled={busy}>Voltar</Button>
            <Button variant="danger" type="submit" busy={busy} disabled={!code || !acknowledged}>Registrar devolução</Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

export function ManualRefundRecord() {
  return <div className="pedido-refund"><StatusBadge tone="success">Estorno registrado após devolução externa</StatusBadge></div>;
}
