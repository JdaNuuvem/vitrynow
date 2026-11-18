"use client";

import { useState } from "react";
import { AuthCard } from "./components/AuthCard";
import { SingleFieldForm } from "./components/SingleFieldForm";
import { useForgotPassword } from "./hooks/useForgotPassword";

export function ForgotPasswordPage() {
  const { submit, loading, sent } = useForgotPassword();
  const [email, setEmail] = useState("");

  return (
    <AuthCard title="Recuperar senha" backToLogin>
      {sent ? (
        <p className="auth__text">
          Se este e-mail estiver cadastrado, enviamos um link de recuperação. Confira sua caixa de entrada (e o spam).
        </p>
      ) : (
        <SingleFieldForm
          type="email"
          placeholder="Seu e-mail"
          value={email}
          onChange={setEmail}
          submitLabel="Enviar"
          loadingLabel="Enviando..."
          loading={loading}
          onSubmit={() => submit(email)}
        />
      )}
    </AuthCard>
  );
}
