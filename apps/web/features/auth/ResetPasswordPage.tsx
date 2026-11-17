"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard } from "./components/AuthCard";
import { SingleFieldForm } from "./components/SingleFieldForm";
import { useResetPassword } from "./hooks/useResetPassword";
import { clearResetTokenFromUrl, readResetToken } from "./resetToken";

export function ResetPasswordPage() {
  const router = useRouter();
  // null = ainda não leu a URL (o fragmento só existe no navegador). O token fica SÓ neste estado; a barra de endereço é
  // limpa na hora. A atualização funcional protege o StrictMode: a 2ª execução do efeito já não acha token na URL e não
  // pode apagar o que a 1ª leu.
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const found = readResetToken(window.location);
    clearResetTokenFromUrl();
    setToken((previous) => previous ?? found);

    // Colar um link novo numa aba que JÁ está em /reset-senha só muda o fragmento (sem recarregar): nenhum efeito rodaria e o
    // token ficaria na barra. Aqui o link novo vale (o do e-mail mais recente) e a barra é limpa de novo. `replaceState` não
    // dispara `hashchange`, então a limpeza não cai em laço.
    const onHashChange = () => {
      const next = readResetToken(window.location);
      clearResetTokenFromUrl();
      setToken(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const { submit, loading, error, done } = useResetPassword(token ?? "");
  const [newPassword, setNewPassword] = useState("");

  if (token === null) return <AuthCard>{null}</AuthCard>;

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
