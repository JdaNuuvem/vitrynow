"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OrderDetail } from "@/core/domain/orderDetail";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";
import { Button, Field, StateMessage } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { Modal } from "@/shared/ui/Modal";

// Ações do detalhe que a API já tinha e o painel não mostrava:
//  - Reimprimir o tíquete (OWNER e STAFF; a fila respeita o modo de impressão da loja).
//  - Observação interna da equipe (até 500 caracteres; o cliente nunca vê).
//  - Encerrar estorno travado (API-69, só o dono, com confirmação de segurança): quando a devolução automática desistiu.

const http = new FetchHttpClient();
const MAX_NOTE = 500;
const ABANDON_REASONS = [
  ["MP_RECUSA", "O Mercado Pago recusou a devolução"],
  ["PAGAMENTO_ANTIGO", "Pagamento antigo demais para devolver"],
  ["CONTA_DESCONECTADA", "A conta do Mercado Pago foi desconectada"],
  ["ACERTADO_COM_CLIENTE", "Devolução acertada direto com o cliente"],
  ["OUTRO", "Outro motivo"],
] as const;

export function OrderExtraActions({ order, owner, onChanged }: { order: OrderDetail; owner: boolean; onChanged: () => void }) {
  return <section className="pedido-extra">
    <ReprintAction orderId={order.id} canceled={order.status === "CANCELADO"} />
    {order.internalNote !== undefined && <InternalNote orderId={order.id} initial={order.internalNote ?? ""} />}
    {owner && order.payment?.refundStuck && <AbandonRefundAction order={order} onDone={onChanged} />}
  </section>;
}

function ReprintAction({ orderId, canceled }: { orderId: string; canceled: boolean }) {
  const [state, setState] = useState<{ busy: boolean; message?: string; tone?: "success" | "danger" }>({ busy: false });
  async function reprint() {
    if (state.busy) return;
    setState({ busy: true });
    const result = await http.post("/api/orders/" + encodeURIComponent(orderId) + "/reprint");
    setState(result.ok ? { busy: false, tone: "success", message: "Tíquete enviado para a impressora." } : { busy: false, tone: "danger", message: result.error });
  }
  if (canceled) return null;
  return <div className="pedido-extra__row">
    <Button icon="printer" busy={state.busy} onClick={() => void reprint()}>Reimprimir tíquete</Button>
    {state.message && <span role="status" className={state.tone === "danger" ? "pedido-extra__error" : "pedido-extra__ok"}>{state.message}</span>}
  </div>;
}

function InternalNote({ orderId, initial }: { orderId: string; initial: string }) {
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => { setSaved(initial); setText(initial); }, [orderId, initial]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || text === saved) return;
    setBusy(true);
    setError("");
    setDone(false);
    const note = text.trim() ? text.trim() : null;
    const result = await http.post<{ internalNote: string | null }>("/api/orders/" + encodeURIComponent(orderId) + "/internal-note", { note });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    const value = result.data.internalNote ?? "";
    setSaved(value);
    setText(value);
    setDone(true);
  }

  return <form className="pedido-extra__note" onSubmit={save}>
    <Field id={`nota-${orderId}`} label="Observação interna (só a equipe vê)">
      <textarea id={`nota-${orderId}`} rows={3} maxLength={MAX_NOTE} value={text} disabled={busy}
        placeholder="Ex.: cliente pediu para ligar ao chegar" onChange={(event) => { setText(event.target.value); setDone(false); }} />
    </Field>
    <div className="pedido-extra__row">
      <span className="pedido-extra__muted">{text.length}/{MAX_NOTE}</span>
      {done && <span role="status" className="pedido-extra__ok">Observação salva.</span>}
      {error && <span role="alert" className="pedido-extra__error">{error}</span>}
      <Button type="submit" busy={busy} disabled={text === saved}>Salvar observação</Button>
    </div>
  </form>;
}

function AbandonRefundAction({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const { runProtected } = useSecurityConfirm();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!code || sending.current) return;
    if (code === "OUTRO" && !note.trim()) return setError("Descreva o motivo.");
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const body = { code, ...(note.trim() ? { note: note.trim() } : {}) };
      const result = await runProtected("refund", (options) => http.post("/api/orders/" + encodeURIComponent(order.id) + "/refund/abandon", body, options));
      if (!result.ok) return setError(result.error);
      setOpen(false);
      onDone();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return <div className="pedido-extra__row">
    <StateMessage tone="warning" title="Devolução automática parou de tentar">
      O sistema tentou devolver {formatCents(order.payment?.amountCents ?? 0)} várias vezes sem sucesso. Resolva pelo Mercado Pago ou com o cliente e encerre aqui.
    </StateMessage>
    <Button variant="danger" onClick={() => { setCode(""); setNote(""); setError(""); setOpen(true); }}>Encerrar estorno</Button>
    <Modal open={open} onClose={() => { if (!sending.current) setOpen(false); }} labelledBy="abandon-title" width={500} fitContent sheetOnMobile>
      <form className="pedido-refund__form" onSubmit={submit}>
        <h2 id="abandon-title">Encerrar estorno do pedido #{order.code}</h2>
        <p>O sistema deixa de tentar devolver o valor. Use quando a devolução foi resolvida por fora ou não é mais possível.</p>
        <Field id="abandon-reason" label="Motivo">
          <select id="abandon-reason" required value={code} disabled={busy} onChange={(event) => setCode(event.target.value)}>
            <option value="">Selecione</option>{ABANDON_REASONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
        <Field id="abandon-note" label={code === "OUTRO" ? "Descreva o motivo" : "Detalhe (opcional)"}>
          <input id="abandon-note" maxLength={200} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {error && <StateMessage tone="danger" title={error} />}
        <div className="pedido-refund__actions">
          <Button onClick={() => setOpen(false)} disabled={busy}>Voltar</Button>
          <Button variant="danger" type="submit" busy={busy} disabled={!code}>Encerrar estorno</Button>
        </div>
      </form>
    </Modal>
  </div>;
}
