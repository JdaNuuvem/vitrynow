"use client";

import { useRef, useState, type FormEvent } from "react";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";
import { Button } from "@/shared/design/components";
import { Modal } from "@/shared/ui/Modal";
import { privacyApi, type PrivacyPreview, type PrivacyReason, type PrivacyTarget } from "./privacyApi";

const reasonLabels: Record<PrivacyReason, string> = {
  HOLDER_REQUEST: "Pedido do cliente",
  STORE_DECISION: "Decisão da loja",
  ACCOUNT_CLOSURE: "Encerramento de conta",
};

export type PrivacyAction = "export" | "anonymize";

function downloadExport(payload: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "vitrynow-dados-do-cliente.json";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function PrivacyConfirmation({ action, target, preview, onDone, onStale, onCancel }: {
  action: PrivacyAction; target: PrivacyTarget; preview: PrivacyPreview;
  onDone: (message: string) => void; onStale: (message: string) => void; onCancel: () => void;
}) {
  const { runProtected } = useSecurityConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const dialog = useRef<HTMLFormElement>(null);
  const close = () => { if (!submitting.current) onCancel(); };
  const exporting = action === "export";
  const confirm = exporting ? "Exportar JSON" : "Anonimizar dados";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const fields = new FormData(event.currentTarget);
    const password = preview.reauth === "PASSWORD" ? String(fields.get("password") ?? "") : undefined;
    const reason = String(fields.get("reason") ?? "") as PrivacyReason;
    if (preview.reauth === "PASSWORD" && !password) return setError("Digite sua senha para confirmar.");
    if (!exporting && (!Object.hasOwn(reasonLabels, reason) || fields.get("confirm") !== "on")) {
      return setError("Informe o motivo e confirme a remoção dos dados pessoais.");
    }
    setError(null);
    setBusy(true);
    submitting.current = true;
    try {
      if (exporting) {
        const result = preview.reauth === "MFA"
          ? await runProtected("export_customer", (options) => privacyApi.export(target, undefined, options))
          : await privacyApi.export(target, password);
        if (!result.ok) { setError(result.error); return; }
        if (result.data.orders.length === 0) { onStale("Nenhum pedido com dados pessoais está disponível para exportação."); return; }
        downloadExport(result.data);
        onDone("Arquivo JSON baixado.");
      } else {
        const result = preview.reauth === "MFA"
          ? await runProtected("anonymize_customer", (options) => privacyApi.anonymize(target, preview.orders, reason, undefined, options))
          : await privacyApi.anonymize(target, preview.orders, reason, password);
        if (!result.ok) {
          if (result.status === 409 || result.status >= 500) {
            onStale(result.status === 409 ? result.error : "A operação ainda não foi confirmada. Consulte o efeito atual antes de tentar novamente.");
          } else setError(result.error);
          return;
        }
        onDone(result.data.nothingToRemove ? "Nenhum dado pessoal para remover." : result.data.anonymized === 1
          ? "Dados pessoais removidos de 1 pedido." : `Dados pessoais removidos de ${result.data.anonymized} pedidos.`);
      }
    } finally {
      const input = dialog.current?.elements.namedItem("password");
      if (input instanceof HTMLInputElement) input.value = "";
      submitting.current = false;
      setBusy(false);
    }
  }

  return <Modal open onClose={close} labelledBy="privacy-confirmation-title" closeOnScrim={false} width={500}>
    <form className="platform-dialog platform-form" onSubmit={submit} ref={dialog} aria-busy={busy}>
      <header><h2 id="privacy-confirmation-title">{confirm}</h2></header>
      <p>{exporting ? "O arquivo contém os dados pessoais associados à consulta. Guarde-o em um local seguro." :
        `A anonimização remove permanentemente os dados pessoais de ${preview.orders} ${preview.orders === 1 ? "pedido" : "pedidos"}. Os registros financeiros são preservados.`}</p>
      {!exporting && <>
        <label className="platform-field">Motivo<select name="reason" defaultValue="" required disabled={busy}>
          <option value="" disabled>Selecione o motivo</option>
          {Object.entries(reasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="privacy-check"><input type="checkbox" name="confirm" required disabled={busy} /> Confirmo a remoção permanente dos dados pessoais.</label>
      </>}
      {preview.reauth === "PASSWORD" ? <label className="platform-field">Sua senha
        <input name="password" type="password" autoComplete="current-password" required maxLength={200} disabled={busy} />
      </label> : <p className="platform-muted">A confirmação usa um código de segurança enviado ao seu e-mail.</p>}
      {error && <p className="platform-message platform-message--error" role="alert">{error}</p>}
      <div className="platform-actions">
        <Button type="button" onClick={close} disabled={busy}>Cancelar</Button>
        <Button type="submit" variant={exporting ? "primary" : "danger"} busy={busy}>{busy ? "Processando…" : confirm}</Button>
      </div>
    </form>
  </Modal>;
}
