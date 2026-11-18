"use client";

import { useEffect, useState } from "react";
import type { MfaPurpose } from "@/core/domain/mfa";
import { Modal } from "@/shared/ui/Modal";

const PURPOSE_LABELS: Record<MfaPurpose, string> = {
  refund: "o estorno do pagamento",
  change_password: "a troca de senha",
  delete_user: "a remoção do usuário",
  device_token_create: "a criação da chave de impressora",
  device_token_revoke: "a revogação da chave de impressora",
  cancel_subscription: "o cancelamento da assinatura",
  invite_owner: "o convite de um novo dono",
};

type SecurityConfirmModalProps = {
  purpose: MfaPurpose | null;
  maskedEmail: string | null;
  busy: boolean;
  error: string | null;
  resendIn: number;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onCancel: () => void;
};

export function SecurityConfirmModal({ purpose, maskedEmail, busy, error, resendIn, onSubmit, onResend, onCancel }: SecurityConfirmModalProps) {
  const [code, setCode] = useState("");

  useEffect(() => {
    if (purpose === null) setCode("");
  }, [purpose]);

  const ready = code.length === 6 && !busy && maskedEmail !== null;

  return (
    <Modal open={purpose !== null} onClose={onCancel} labelledBy="security-confirm-title" width={420} closeOnScrim={false}>
      <form
        className="security-confirm"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onSubmit(code);
        }}
      >
        <h3 id="security-confirm-title">Confirmação de segurança</h3>
        <p>
          {maskedEmail ? (
            <>
              Enviamos um código para o e-mail <b>{maskedEmail}</b>. Digite-o abaixo para confirmar {purpose ? PURPOSE_LABELS[purpose] : "esta ação"}.
            </>
          ) : (
            "Enviando o código por e-mail..."
          )}
        </p>
        <input
          className="security-confirm__code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          aria-label="Código de 6 dígitos"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          autoFocus
        />
        {error && <p className="security-confirm__error">{error}</p>}
        <button type="submit" className="security-confirm__primary" disabled={!ready}>
          {busy ? "Aguarde..." : "Confirmar"}
        </button>
        <button type="button" className="security-confirm__link" disabled={busy || resendIn > 0} onClick={onResend}>
          {resendIn > 0 ? `Reenviar código em ${resendIn}s` : "Reenviar código"}
        </button>
        <button type="button" className="security-confirm__secondary" onClick={onCancel}>
          Cancelar
        </button>
      </form>
    </Modal>
  );
}
