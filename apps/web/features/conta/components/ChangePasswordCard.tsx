"use client";

import { useState } from "react";
import { CHANGE_PASSWORD_CARD_TITLE, isPasswordRuleError, PASSWORD_HELP } from "@/shared/auth/passwordPolicy";
import { usePasswordRule } from "@/shared/auth/usePasswordRule";
import { PasswordField } from "@/shared/ui/PasswordField";
import { Field } from "./Field";

export function ChangePasswordCard({
  onChangePassword,
}: {
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rejectedLength, setRejectedLength] = useState(false);
  const rule = usePasswordRule(newPassword, rejectedLength);

  async function submit() {
    setError(null);
    setSaved(false);
    setRejectedLength(false);
    if (!rule.validate()) return;
    const failure = await onChangePassword(currentPassword, newPassword);
    if (failure) {
      // recusa por tamanho: a mesma frase no campo; outros erros (ex.: senha atual incorreta) ficam como vieram
      if (isPasswordRuleError(failure)) return setRejectedLength(true);
      return setError(failure);
    }
    setCurrentPassword("");
    setNewPassword("");
    setSaved(true);
  }

  return (
    <div className="conta__card conta__card--spaced">
      <h2>{CHANGE_PASSWORD_CARD_TITLE}</h2>
      {/* "Senha atual" não tem regra de tamanho: contas antigas podem ter senha curta */}
      <Field type="password" maxLength={200} placeholder="Senha atual" value={currentPassword} onChange={setCurrentPassword} />
      <PasswordField
        label="Nova senha"
        value={newPassword}
        onChange={(value) => {
          setNewPassword(value);
          setRejectedLength(false);
        }}
        help={PASSWORD_HELP}
        error={rule.error}
        onBlur={rule.onBlur}
      />
      {error && <p className="conta__error">{error}</p>}
      {saved && <p className="conta__ok">Senha alterada.</p>}
      <button type="button" className="conta__primary" onClick={submit}>
        Trocar senha
      </button>
    </div>
  );
}
