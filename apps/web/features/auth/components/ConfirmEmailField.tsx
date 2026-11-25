"use client";

import { forwardRef, useId } from "react";
import { CONFIRM_EMAIL_HELP, CONFIRM_EMAIL_LABEL } from "@/shared/auth/passwordPolicy";

// "Confirme o e-mail desta conta" (spec 16 §6). A máscara do bloco de cima é só dica: a prova de que a pessoa é dona do link é ela
// DIGITAR o e-mail, e quem compara é o servidor. type=email e autocomplete=username (o gerenciador liga a senha ao e-mail certo; se
// preencher o da vítima com o token do atacante, o servidor recusa do mesmo jeito). Sem preenchimento sozinho e sem foco automático.
export const ConfirmEmailField = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (value: string) => void; disabled?: boolean; describedBy?: string[] }
>(function ConfirmEmailField({ value, onChange, disabled, describedBy = [] }, ref) {
  const uid = useId();
  const inputId = `${uid}-email`;
  const helpId = `${uid}-email-help`;
  return (
    <div className="pw-field">
      <label htmlFor={inputId} className="pw-field__label">
        {CONFIRM_EMAIL_LABEL}
      </label>
      <input
        ref={ref}
        id={inputId}
        className="auth__input"
        type="email"
        maxLength={200}
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-describedby={[...describedBy, helpId].join(" ")}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={helpId} className="pw-field__help">
        {CONFIRM_EMAIL_HELP}
      </p>
    </div>
  );
});
