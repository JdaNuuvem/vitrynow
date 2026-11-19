"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { AuthCard } from "./components/AuthCard";

const http = new FetchHttpClient();

export function VerifyEmailPage() {
  const captured = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
    if (!value || value.length > 200) setError("Abra o link de confirmação enviado ao seu e-mail.");
    else setToken(value);
  }, []);

  async function confirm() {
    if (!token) return;
    setError(null);
    setPending(true);
    const result = await http.post("/auth/verify-email", { token });
    setPending(false);
    if (result.ok) {
      setToken(null);
      setDone(true);
    } else {
      setError(result.error);
      if (result.code === "VERIFY_TOKEN_INVALID") setToken(null);
    }
  }

  return (
    <AuthCard title="Confirmar e-mail">
      {error && <p className="auth__error" role="alert">{error}</p>}
      {done && <p className="auth__ok" role="status">E-mail confirmado.</p>}
      {token && <button className="auth__button" type="button" disabled={pending} onClick={() => void confirm()}>{pending ? "Confirmando…" : "Confirmar meu e-mail"}</button>}
      {!token && <Link className="auth__link" href="/dashboard/primeiros-passos">Abrir primeiros passos</Link>}
    </AuthCard>
  );
}
