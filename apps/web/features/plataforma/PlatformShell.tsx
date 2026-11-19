"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { HttpResult } from "@/core/http/HttpClient";
import { Button } from "@/shared/design/components";
import { ThemeControls } from "@/shared/design/ThemeControls";
import { VitryBrand } from "@/shared/ui/VitryBrand";
import { platformApi, type PlatformSession } from "./platformApi";

type PlatformContextValue = {
  session: PlatformSession;
  request: <T>(action: () => Promise<HttpResult<T>>) => Promise<HttpResult<T>>;
};
const PlatformContext = createContext<PlatformContextValue | null>(null);

export function usePlatform() {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error("Plataforma precisa de uma sessão própria.");
  return platform;
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const clearSession = useCallback(() => {
    setSession(null);
    router.replace("/plataforma/login");
  }, [router]);

  useEffect(() => {
    let current = true;
    platformApi.me().then((result) => {
      if (!current) return;
      if (result.ok) setSession(result.data);
      else if (result.status === 401) clearSession();
      else setError(result.error);
    });
    return () => { current = false; };
  }, [clearSession, refresh]);

  const request = useCallback(async <T,>(action: () => Promise<HttpResult<T>>) => {
    const result = await action();
    if (!result.ok && result.status === 401) clearSession();
    return result;
  }, [clearSession]);

  async function logout() {
    setLeaving(true);
    const result = await platformApi.logout();
    if (result.ok || result.status === 401) clearSession();
    else {
      setError(result.error);
      setLeaving(false);
    }
  }

  if (!session) {
    return <main className="platform-auth"><section className="platform-panel platform-auth__card" aria-busy={!error}>
      <VitryBrand />
      <h1>Área da plataforma</h1>
      {error ? <>
        <p className="platform-message platform-message--error" role="alert">{error}</p>
        <Button onClick={() => { setError(null); setRefresh((value) => value + 1); }}>Tentar novamente</Button>
      </> : <p role="status">Verificando sessão…</p>}
    </section></main>;
  }

  return <PlatformContext.Provider value={{ session, request }}>
    <div className="panel-root platform-layout">
      <header className="platform-topbar">
        <div className="platform-topbar__inner">
          <Link className="platform-brand" href="/plataforma" aria-label="VitryNow Plataforma"><VitryBrand /><span>Plataforma</span></Link>
          <div className="platform-account">
            <ThemeControls compact />
            <div className="platform-account__name"><strong>{session.role === "ADMIN" ? "Administrador" : "Suporte"}</strong><small>{session.email}</small></div>
            <Button onClick={() => void logout()} busy={leaving}>Sair</Button>
          </div>
        </div>
      </header>
      <div className="platform-body">
        <nav className="platform-nav" aria-label="Navegação da plataforma">
          <Link href="/plataforma" aria-current={pathname === "/plataforma" || pathname.startsWith("/plataforma/lojas/") ? "page" : undefined}>Lojas</Link>
          <Link href="/plataforma/avisos" aria-current={pathname === "/plataforma/avisos" ? "page" : undefined}>Avisos</Link>
        </nav>
        <main className="platform-content">
          {error && <p className="platform-message platform-message--error" role="alert">{error}</p>}
          {children}
        </main>
      </div>
    </div>
  </PlatformContext.Provider>;
}
