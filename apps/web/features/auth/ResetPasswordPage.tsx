"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthCard } from "./components/AuthCard";
import { SingleFieldForm } from "./components/SingleFieldForm";
import { useResetPassword } from "./hooks/useResetPassword";

export function ResetPasswordPage() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const { submit, loading, error, done } = useResetPassword(token);
  const [newPassword, setNewPassword] = useState("");

  if (!token) {
    return (
      <AuthCard>
        <p className="auth__text">Link inválido — peça um novo em &quot;esqueci minha senha&quot;.</p>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard>
        <p className="auth__ok">Senha alterada com sucesso.</p>
        <button className="auth__button" onClick={() => router.push("/login")}>
          Ir para o login
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Nova senha" backToLogin>
      <SingleFieldForm
        type="password"
        placeholder="Nova senha"
        minLength={6}
        value={newPassword}
        onChange={setNewPassword}
        submitLabel="Salvar nova senha"
        loadingLabel="Salvando..."
        loading={loading}
        error={error}
        onSubmit={() => submit(newPassword)}
      />
    </AuthCard>
  );
}
