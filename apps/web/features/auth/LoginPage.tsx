"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard } from "./components/AuthCard";
import { useLogin } from "./hooks/useLogin";

export function LoginPage() {
  const { submit, loading, error } = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit(email, password);
  }

  return (
    <AuthCard title="Entrar no painel">
      <form onSubmit={handleSubmit} className="auth__form">
        <label className="auth__field">
          E-mail
          <input className="auth__input" type="email" autoComplete="username" required placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="auth__field">
          Senha
          <input
            className="auth__input"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="auth__error" role="alert">{error}</p>}
        <button className="auth__button" type="submit" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
      <Link href="/esqueci-senha" className="auth__link">
        Esqueci minha senha
      </Link>
      <Link href="/cadastro" className="auth__link">Criar minha loja</Link>
    </AuthCard>
  );
}
