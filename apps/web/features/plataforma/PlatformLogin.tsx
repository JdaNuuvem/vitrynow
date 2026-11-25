"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/shared/design/components";
import { ThemeControls } from "@/shared/design/ThemeControls";
import { VitryBrand } from "@/shared/ui/VitryBrand";
import { platformApi, type PlatformChallenge } from "./platformApi";

export function PlatformLogin() {
  const router = useRouter();
  const [challenge, setChallenge] = useState<PlatformChallenge | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    submitting.current = true;
    setBusy(true);
    setError(null);
    if (challenge) {
      const result = await platformApi.verifyLogin(challenge.challengeId, String(fields.get("code") ?? ""));
      if (result.ok) {
        form.reset();
        router.replace("/plataforma");
        return;
      }
      if (["MFA_LOCKED", "MFA_EXPIRED"].includes(result.code ?? "")) setChallenge(null);
      setError(result.error);
    } else {
      const result = await platformApi.login(email.trim(), String(fields.get("password") ?? ""));
      form.reset();
      if (result.ok) setChallenge(result.data);
      else setError(result.error);
    }
    setBusy(false);
    submitting.current = false;
  }

  return <main className="platform-auth">
    <div className="platform-auth__theme"><ThemeControls compact /></div>
    <section className="platform-panel platform-auth__card">
      <VitryBrand />
      <header><h1>{challenge ? "Confirme sua entrada" : "Área da plataforma"}</h1>
        <p>{challenge ? `Digite o código enviado para ${challenge.maskedEmail}.` : "Acesso da equipe VitryNow."}</p></header>
      <form key={challenge?.challengeId ?? "login"} className="platform-form" onSubmit={submit} aria-busy={busy}>
        {challenge ? <label className="platform-field">Código de segurança
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus />
        </label> : <>
          <label className="platform-field">E-mail
            <input type="email" name="email" autoComplete="username" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="platform-field">Senha
            <input type="password" name="password" autoComplete="current-password" maxLength={200} required />
          </label>
        </>}
        {error && <p className="platform-message platform-message--error" role="alert">{error}</p>}
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? "Aguarde…" : challenge ? "Confirmar entrada" : "Enviar código"}
        </Button>
        {challenge && <Button variant="quiet" disabled={busy} onClick={() => { setChallenge(null); setError(null); }}>Voltar e solicitar outro código</Button>}
      </form>
    </section>
  </main>;
}
