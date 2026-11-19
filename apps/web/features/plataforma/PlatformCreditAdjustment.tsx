"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/shared/design/components";
import { digitsToCents } from "@/shared/format/money";
import { Modal } from "@/shared/ui/Modal";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { usePlatform } from "./PlatformShell";
import { platformApi, type CreditInput, type CreditReason, type PlatformChallenge } from "./platformApi";

const creditReasons: Record<CreditReason, string> = { PURCHASE: "Compra", GRANT: "Concessão", ADJUST: "Ajuste" };
const ledgerReasons: Record<string, string> = { ...creditReasons, RESERVE: "Reserva", CONSUME: "Uso", RELEASE: "Liberação" };
const REFERENCE = /^[\w .\-/#:]{3,120}$/;

export function creditReasonLabel(reason: string) {
  return ledgerReasons[reason] ?? reason;
}

export function PlatformCreditAdjustment({ storeId, storeName, onClose, onDone }: {
  storeId: string; storeName: string; onClose: () => void; onDone: () => void;
}) {
  const { request } = usePlatform();
  const [reason, setReason] = useState<CreditReason>("GRANT");
  const [credits, setCredits] = useState("");
  const [price, setPrice] = useState("");
  const [operation, setOperation] = useState<{ input: CreditInput; key: string } | null>(null);
  const [challenge, setChallenge] = useState<PlatformChallenge | null>(null);
  const [password, setPassword] = useState("");
  const [verified, setVerified] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const close = () => { if (!running.current && !uncertain) onClose(); };
  const negative = reason === "ADJUST" && Number(credits) < 0;

  useEffect(() => {
    if (!resendSeconds) return;
    const timer = window.setTimeout(() => setResendSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const delta = Number(credits);
    const note = String(fields.get("note") ?? "").trim();
    const reference = String(fields.get("reference") ?? "").trim();
    const expiresAt = String(fields.get("expiry") ?? "");
    if (!Number.isInteger(delta) || delta === 0 || (delta < 0 && reason !== "ADJUST")) return setError("Informe uma quantidade válida de créditos.");
    if (note.length < 5) return setError("Informe uma observação com pelo menos cinco caracteres.");
    if ((reason === "PURCHASE" || reference) && !REFERENCE.test(reference)) return setError("Informe uma referência válida. Use letras, números, espaço e os sinais . - / # : ou _.");
    if (price && digitsToCents(price) > 100_000_000) return setError("O valor informado excede o limite.");
    setError(null);
    setOperation({ key: window.crypto.randomUUID(), input: {
      reason, credits: delta, note, externalRef: !negative && reference ? reference : undefined,
      priceCents: !negative && price ? digitsToCents(price) : undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    } });
  }

  async function sendCode() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const result = await request(platformApi.creditChallenge);
    if (result.ok) {
      setChallenge(result.data);
      setVerified(false);
      setResendSeconds(60);
    } else setError(result.error);
    running.current = false;
    setBusy(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operation || !challenge || running.current) return;
    const fields = new FormData(event.currentTarget);
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!verified) {
        const result = await request(() => platformApi.verifyCreditChallenge(challenge.challengeId, String(fields.get("code") ?? "")));
        if (!result.ok) {
          setError(result.error);
          if (["MFA_LOCKED", "MFA_EXPIRED"].includes(result.code ?? "")) setChallenge(null);
          return;
        }
        setVerified(true);
      }
      const result = await request(() => platformApi.grantCredits(storeId, operation.input, operation.key, password, challenge.challengeId));
      setPassword("");
      if (result.ok) { onDone(); return; }
      if (result.code === "MFA_REQUIRED") {
        setVerified(false);
        setChallenge(null);
      }
      if (result.status >= 500) {
        setUncertain(true);
        setError("O lançamento ainda não foi confirmado. Repita a confirmação para consultar ou concluir a mesma operação.");
      } else {
        if (result.code === "CREDIT_NEGATIVE_BALANCE") setUncertain(false);
        setError(result.error);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return <Modal open onClose={close} labelledBy="platform-credit-adjustment-title" width={540} closeOnScrim={false}>
    <div className="platform-dialog">
      <header><h2 id="platform-credit-adjustment-title">{operation ? "Confirmar lançamento" : "Registrar créditos"}</h2><p>{storeName}</p></header>
      {!operation ? <form className="platform-form" onSubmit={prepare}>
        <label className="platform-field">Operação<select value={reason} onChange={(event) => setReason(event.target.value as CreditReason)}>
          {Object.entries(creditReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <div className="platform-form__pair">
          <label className="platform-field">Quantidade<input type="number" min={reason === "ADJUST" ? -1000 : 1} max={1000} step={1} required value={credits} onChange={(event) => setCredits(event.target.value)} /></label>
          <label className="platform-field">Validade opcional<input type="datetime-local" name="expiry" /></label>
        </div>
        {!negative && <div className="platform-form__pair">
          <label className="platform-field">Referência do pagamento{reason === "PURCHASE" ? "" : " opcional"}<input name="reference" maxLength={120} required={reason === "PURCHASE"} /></label>
          <label className="platform-field">Valor opcional<MoneyInput value={price} onChange={setPrice} name="price" /></label>
        </div>}
        <label className="platform-field">Observação<textarea name="note" rows={2} minLength={5} maxLength={300} required /></label>
        {error && <p className="platform-message platform-message--error" role="alert">{error}</p>}
        <div className="platform-actions"><Button type="button" onClick={close}>Cancelar</Button><Button type="submit" variant="primary">Revisar lançamento</Button></div>
      </form> : <form className="platform-form" onSubmit={submit}>
        <p><strong>{creditReasonLabel(operation.input.reason)} de {operation.input.credits} créditos</strong></p>
        {challenge && !verified && <label className="platform-field">Código enviado para {challenge.maskedEmail}
          <input key={challenge.challengeId} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} />
        </label>}
        {challenge && <label className="platform-field">Sua senha
          <input name="password" type="password" autoComplete="current-password" required maxLength={200} disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>}
        {error && <p className="platform-message platform-message--error" role="alert">{error}</p>}
        {(!challenge || !verified) && <Button variant={challenge ? "quiet" : "secondary"} disabled={busy || resendSeconds > 0} type="button" onClick={() => void sendCode()}>
          {resendSeconds > 0 ? `Novo código em ${resendSeconds}s` : challenge ? "Reenviar código" : "Enviar código de segurança"}
        </Button>}
        <div className="platform-actions">
          <Button type="button" disabled={busy || uncertain} onClick={close}>Cancelar</Button>
          {challenge && <Button type="submit" variant="primary" busy={busy}>Confirmar lançamento</Button>}
        </div>
      </form>}
    </div>
  </Modal>;
}
