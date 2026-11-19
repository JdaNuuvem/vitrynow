"use client";

import { useRef, useState } from "react";
import { isPasswordRuleError, PASSWORD_HELP_STAFF } from "@/shared/auth/passwordPolicy";
import { usePasswordRule } from "@/shared/auth/usePasswordRule";
import { PasswordField } from "@/shared/ui/PasswordField";
import { Button } from "@/shared/design/components";

export function InviteStaffCard({
  error,
  onInvite,
}: {
  error: string | null;
  onInvite: (email: string, password: string) => Promise<boolean>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const serverRejectedLength = isPasswordRuleError(error);
  const rule = usePasswordRule(password, serverRejectedLength);

  async function submit() {
    if (running.current || !rule.validate()) return;
    running.current = true;
    setBusy(true);
    try {
      if (!(await onInvite(email.trim(), password))) return;
      setEmail("");
      setPassword("");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="equipe-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy}>
        <label>E-mail<input type="email" required autoComplete="off" placeholder="nome@exemplo.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <PasswordField label="Senha do funcionário" value={password} onChange={setPassword} help={PASSWORD_HELP_STAFF} error={rule.error} onBlur={rule.onBlur} />
        {error && !serverRejectedLength && <p className="equipe__error" role="alert">{error}</p>}
      </fieldset>
      <Button type="submit" variant="primary" busy={busy}>Adicionar funcionário</Button>
    </form>
  );
}
