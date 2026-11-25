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
      <label className="auth__field">
        {type === "email" ? "E-mail" : "Nova senha"}
        <input
          className="auth__input"
          type={type}
          autoComplete={type === "email" ? "username" : "new-password"}
          required
          minLength={minLength}
          maxLength={200} /* teto do servidor para e-mail e senha */
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {error && <p className="auth__error" role="alert">{error}</p>}
      <button className="auth__button" type="submit" disabled={loading}>
        {loading ? loadingLabel : submitLabel}
      </button>
    </form>
  );
}
