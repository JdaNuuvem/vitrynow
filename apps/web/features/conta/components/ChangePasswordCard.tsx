"use client";

import { useState } from "react";
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

  async function submit() {
    setError(null);
    setSaved(false);
    const failure = await onChangePassword(currentPassword, newPassword);
    if (failure) return setError(failure);
    setCurrentPassword("");
    setNewPassword("");
    setSaved(true);
  }

  return (
    <div className="conta__card conta__card--spaced">
      <h2>Minha senha</h2>
      <Field type="password" placeholder="Senha atual" value={currentPassword} onChange={setCurrentPassword} />
      <Field type="password" placeholder="Nova senha" value={newPassword} onChange={setNewPassword} />
      {error && <p className="conta__error">{error}</p>}
      {saved && <p className="conta__ok">Senha alterada.</p>}
      <button type="button" className="conta__primary" onClick={submit}>
        Trocar senha
      </button>
    </div>
  );
}
