"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { PasswordField } from "@/shared/ui/PasswordField";
import { isPasswordRuleError, PASSWORD_HELP } from "@/shared/auth/passwordPolicy";
import { usePasswordRule } from "@/shared/auth/usePasswordRule";
import { AuthCard } from "./components/AuthCard";
import { useResetInspect } from "./hooks/useResetInspect";
import { useResetPassword } from "./hooks/useResetPassword";
import { clearResetTokenFromUrl, readResetToken } from "./resetToken";

function InvalidLink() {
  return (
    <AuthCard>
      <p className="auth__text">Link inválido — peça um novo em &quot;esqueci minha senha&quot;.</p>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
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

  if (token === null) return <AuthCard>{null}</AuthCard>;
  if (!token) return <InvalidLink />;
  // `key={token}`: um link novo REMONTA o fluxo e zera tudo (conferência, senha digitada, "senha alterada"); nada do link
  // anterior vaza para o novo.
  return <ResetFlow key={token} token={token} />;
}

function ResetFlow({ token }: { token: string }) {
  const router = useRouter();
  const { submit, loading, error, done } = useResetPassword(token);
  const { result: inspect, retry } = useResetInspect(token);
  const noteId = useId();
  const [newPassword, setNewPassword] = useState("");
  const serverRejectedLength = isPasswordRuleError(error);
  const rule = usePasswordRule(newPassword, serverRejectedLength);

  // Inválido, vencido, usado ou malformado: a API não diferencia o motivo e a tela também não.
  if (inspect.state === "invalid") return <InvalidLink />;

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

  // Falha fechada (SEC-29): sem confirmar de qual conta é o link, NÃO há campo de senha.
  if (inspect.state === "checking") {
    return (
      <AuthCard title="Nova senha" backToLogin>
        <p className="auth__text" role="status">
          Conferindo o link...
        </p>
      </AuthCard>
    );
  }
  if (inspect.state === "failed") {
    return (
      <AuthCard title="Nova senha" backToLogin>
        <div role="alert" className="auth__alert">
          <div className="auth__alert-head">
            {/* ícone de atenção de linha (padrão das faixas de atenção); decorativo, o texto já diz tudo */}
            <svg className="auth__alert-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="auth__text">Não foi possível confirmar a conta deste link. Tente de novo.</p>
          </div>
          <button type="button" className="auth__button" onClick={retry}>
            Tentar de novo
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Nova senha" backToLogin>
      <form
        className="auth__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (loading || !rule.validate()) return;
          void submit(newPassword);
        }}
      >
        {/* Conferência: DE QUAL conta é este link (o e-mail mascarado entra como TEXTO, nunca HTML) e o aviso de quem recebeu o link de outra pessoa */}
        <div id={noteId} role="note" className="auth__note">
          <p>
            Você está redefinindo a senha de <strong>{inspect.email}</strong>
          </p>
          <p>Se esta não for a sua conta, feche esta página e não digite nenhuma senha.</p>
        </div>
        <PasswordField
          label="Nova senha"
          value={newPassword}
          onChange={setNewPassword}
          help={PASSWORD_HELP}
          error={rule.error}
          onBlur={rule.onBlur}
          describedBy={[noteId]}
          inputClassName="auth__input"
        />
        {error && !serverRejectedLength && <p className="auth__error">{error}</p>}
        <button className="auth__button" type="submit" disabled={loading}>
          {loading ? "Salvando..." : "Salvar nova senha"}
        </button>
      </form>
    </AuthCard>
  );
}
