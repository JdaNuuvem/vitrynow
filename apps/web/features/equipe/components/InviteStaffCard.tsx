"use client";

import { useState } from "react";

export function InviteStaffCard({
  error,
  onInvite,
}: {
  error: string | null;
  onInvite: (email: string, password: string) => Promise<boolean>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit() {
    if (!(await onInvite(email, password))) return;
    setEmail("");
    setPassword("");
  }

  return (
    <div className="equipe-card">
      <h2>Adicionar funcionário</h2>
      <input placeholder="E-mail" value={email} onChange={(event) => setEmail(event.target.value)} />
      <input
        type="password"
        placeholder="Senha provisória (mín. 6 caracteres)"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error && <p className="equipe__error">{error}</p>}
      <button type="button" className="equipe__button" onClick={submit}>
        Adicionar
      </button>
    </div>
  );
}
