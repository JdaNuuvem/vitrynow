import { useId, type ReactNode } from "react";

// Rótulo + input de texto — o padrão repetido em todos os campos do formulário.
// `error` liga a mensagem ao campo (aria-invalid + aria-describedby) e a anuncia como alerta.
export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  adornment,
  error,
  inputRef,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  adornment?: ReactNode;
  error?: string | null;
  inputRef?: (element: HTMLInputElement | null) => void;
}) {
  const inputId = useId();
  const errorId = `${inputId}-erro`;
  return (
    <div className="conta__field">
      {label && <label htmlFor={inputId}>{label}</label>}
      <div className="conta__field-input">
        <input
          id={inputId}
          ref={inputRef}
          type={type}
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {adornment}
      </div>
      {error && (
        <p id={errorId} role="alert" className="conta__field-error">
          {error}
        </p>
      )}
    </div>
  );
}
