"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { Button } from "@/shared/design/components";
import { isPasswordLongEnough, PASSWORD_HELP, PASSWORD_TOO_SHORT_MESSAGE } from "@/shared/auth/passwordPolicy";
import { PasswordField } from "@/shared/ui/PasswordField";
import { AuthCard } from "./components/AuthCard";

const http = new FetchHttpClient();

export function RegisterPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [availability, setAvailability] = useState<{ state: "checking" | "available" | "unavailable" | "error"; message: string } | null>(null);
  const checkVersion = useRef(0);

  async function checkSlug() {
    const candidate = slug.trim();
    if (!/^[a-z0-9-]{1,80}$/.test(candidate)) return;
    const version = ++checkVersion.current;
    setAvailability({ state: "checking", message: "Verificando endereço…" });
    const result = await http.get<{ available: boolean }>("/auth/slug-availability?slug=" + encodeURIComponent(candidate));
    if (version !== checkVersion.current) return;
    if (!result.ok) setAvailability({ state: "error", message: "Não foi possível verificar agora." });
    else if (result.data.available) setAvailability({ state: "available", message: "Endereço disponível." });
    else setAvailability({ state: "unavailable", message: "Escolha outro endereço." });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (pending) return;
    if (availability?.state === "unavailable") return setError("Escolha outro endereço para o cardápio.");
    if (!isPasswordLongEnough(password)) return setPasswordError(PASSWORD_TOO_SHORT_MESSAGE);
    const form = new FormData(event.currentTarget);
    setPending(true);
    const result = await http.post("/auth/register", {
      storeName: String(form.get("storeName") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      slug: slug.trim(),
      password,
    });
    setPending(false);
    if (result.ok) {
      router.replace("/dashboard/primeiros-passos");
    } else {
      setError(result.code === "STORE_IN_USE" ? "Esse endereço já está em uso. Escolha outro." : result.error);
    }
  }

  return (
    <AuthCard title="Criar minha loja" backToLogin>
      <form className="auth__form" onSubmit={submit}>
        <label className="auth__field">Nome da loja<input className="auth__input" name="storeName" autoComplete="organization" required maxLength={150} /></label>
        <label className="auth__field">
          Endereço do cardápio
          <input className="auth__input" name="slug" autoCapitalize="none" spellCheck={false} pattern="[a-z0-9\-]+" required maxLength={80}
            aria-describedby="register-slug-help register-slug-status" aria-invalid={availability?.state === "unavailable" || undefined} value={slug} onChange={(event) => {
              checkVersion.current++;
              setAvailability(null);
              setSlug(event.target.value.toLowerCase());
            }} />
          <span className="auth__text" id="register-slug-help">Use letras minúsculas, números e hífen. Exemplo: /loja/minha-loja</span>
        </label>
        <div className="auth__path-check">
          <Button variant="quiet" type="button" disabled={!/^[a-z0-9-]{1,80}$/.test(slug) || pending || availability?.state === "checking"} onClick={() => void checkSlug()}>Verificar endereço</Button>
          <span id="register-slug-status" className={"auth__path-status auth__path-status--" + (availability?.state ?? "idle")} role="status">{availability?.message}</span>
        </div>
        <label className="auth__field">E-mail<input className="auth__input" name="email" type="email" maxLength={200} autoComplete="email" required /></label>
        <PasswordField label="Senha" value={password} onChange={(value) => { setPassword(value); setPasswordError(null); }} help={PASSWORD_HELP} error={passwordError} disabled={pending} inputClassName="auth__input" />
        {error && <p className="auth__error" role="alert">{error}</p>}
        <Button className="auth__button" variant="primary" type="submit" busy={pending}>{pending ? "Criando loja…" : "Criar loja"}</Button>
      </form>
    </AuthCard>
  );
}
