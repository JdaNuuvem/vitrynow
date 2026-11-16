import type { FormEvent } from "react";

// Formulário de um campo + botão, usado por "esqueci a senha" (e-mail) e "nova senha".
export function SingleFieldForm({
  type,
  placeholder,
  value,
  onChange,
  submitLabel,
  loadingLabel,
  loading,
  error,
  minLength,
  onSubmit,
}: {
  type: "email" | "password";
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  submitLabel: string;
  loadingLabel: string;
  loading: boolean;
  error?: string | null;
  minLength?: number;
  onSubmit: () => void;
}) {
  const handle = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={handle} className="auth__form">
      <input
        className="auth__input"
        type={type}
        required
        minLength={minLength}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p className="auth__error">{error}</p>}
      <button className="auth__button" type="submit" disabled={loading}>
        {loading ? loadingLabel : submitLabel}
      </button>
    </form>
  );
}
