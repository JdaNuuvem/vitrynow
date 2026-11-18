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
        <input className="auth__input" type="email" required placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          className="auth__input"
          type="password"
          required
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="auth__error">{error}</p>}
        <button className="auth__button" type="submit" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
      <Link href="/esqueci-senha" className="auth__link">
        Esqueci minha senha
      </Link>
    </AuthCard>
  );
}
