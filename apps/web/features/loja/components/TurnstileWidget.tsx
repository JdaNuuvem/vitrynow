"use client";

import { useEffect, useRef, useState } from "react";

// NG-08: captcha do pedido público com o Cloudflare Turnstile. Só aparece quando a API pede (CAPTCHA_REQUIRED: o mesmo telefone
// já tem pedidos pendentes); o cliente comum nunca vê. O script vem de UMA origem fixa, liberada no CSP só quando a chave existe
// no build (lib/securityHeaders.mjs). O token é de uso único: quem usa descarta depois de enviar.

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};
declare global {
  interface Window { turnstile?: Turnstile }
}

let loading: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile ausente")));
    script.onerror = () => {
      loading = null; // permite tentar de novo
      reject(new Error("turnstile não carregou"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [failed, setFailed] = useState(!TURNSTILE_SITE_KEY);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !box.current) return;
    let widgetId: string | null = null;
    let alive = true;
    loadTurnstile()
      .then((turnstile) => {
        if (!alive || !box.current) return;
        widgetId = turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          language: "pt-br",
          callback: (token: string) => callback.current(token),
          "error-callback": () => setFailed(true),
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  if (failed) {
    return <p className="loja__error-text">Não foi possível carregar a verificação. Recarregue a página ou fale com a loja.</p>;
  }
  return <div ref={box} className="loja__captcha" aria-label="Verificação de segurança" />;
}
