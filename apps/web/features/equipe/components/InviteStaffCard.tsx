"use client";

import { useState } from "react";
import { isPasswordRuleError, PASSWORD_HELP_STAFF } from "@/shared/auth/passwordPolicy";
import { usePasswordRule } from "@/shared/auth/usePasswordRule";
import { PasswordField } from "@/shared/ui/PasswordField";

export function InviteStaffCard({
  error,
  onInvite,
}: {
  error: string | null;
  onInvite: (email: string, password: string) => Promise<boolean>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const serverRejectedLength = isPasswordRuleError(error);
  const rule = usePasswordRule(password, serverRejectedLength);

  async function submit() {
    if (!rule.validate()) return;
    if (!(await onInvite(email, password))) return;
    setEmail("");
    setPassword("");
  }

  return (
    <div className="equipe-card">
      <h2>Adicionar funcionário</h2>
      <input placeholder="E-mail" value={email} onChange={(event) => setEmail(event.target.value)} />
      <PasswordField label="Senha do funcionário" value={password} onChange={setPassword} help={PASSWORD_HELP_STAFF} error={rule.error} onBlur={rule.onBlur} />
      {error && !serverRejectedLength && <p className="equipe__error">{error}</p>}
      <button type="button" className="equipe__button" onClick={submit}>
        Adicionar
      </button>
    </div>
  );
}
