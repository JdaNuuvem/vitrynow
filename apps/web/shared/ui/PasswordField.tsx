"use client";

import { useId, useState } from "react";
import "./password-field.css";

// Campo de senha NOVA (spec 16 da Da Vinci): rótulo visível, botão "Mostrar senha"/"Ocultar senha" (44 px, aria-pressed), ajuda
// FIXA embaixo (sempre visível, não só depois do erro) e erro em role="alert" com aria-invalid. O campo liga a ajuda (e o erro, e
// o que a tela passar em `describedBy`, ex.: o bloco do e-mail mascarado) por aria-describedby. Sem foco automático.
export function PasswordField({
  label,
  value,
  onChange,
  help,
  error,
  onBlur,
  describedBy = [],
  inputClassName,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help: string;
  error: string | null;
  onBlur?: () => void;
  describedBy?: string[];
  inputClassName?: string;
  disabled?: boolean;
}) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const helpId = `${uid}-help`;
  const errorId = `${uid}-error`;
  const [visible, setVisible] = useState(false);

  return (
    <div className="pw-field">
      <div className="pw-field__head">
        <label htmlFor={inputId} className="pw-field__label">
          {label}
        </label>
        <button type="button" className="pw-field__toggle" aria-pressed={visible} aria-controls={inputId} onClick={() => setVisible((previous) => !previous)}>
          {visible ? "Ocultar senha" : "Mostrar senha"}
        </button>
      </div>
      <input
        id={inputId}
        className={inputClassName ?? "pw-field__input"}
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={[...describedBy, helpId, ...(error ? [errorId] : [])].join(" ")}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <p id={helpId} className="pw-field__help">
        {help}
      </p>
      {error && (
        <p id={errorId} role="alert" className="pw-field__error">
          {error}
        </p>
      )}
    </div>
  );
}
