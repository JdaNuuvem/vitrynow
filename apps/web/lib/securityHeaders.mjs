// NG-07 / ST-09: cabeçalhos de segurança do web (CSP e afins). Módulo .mjs puro para o next.config.mjs
// importar e o vitest testar sem subir o Next.
//
// Limites honestos da política:
//  - `script-src 'unsafe-inline'`: o Next 14 injeta scripts inline de hidratação. A saída "certa" é CSP com
//    nonce por requisição (middleware), mas isso torna TODAS as páginas dinâmicas e quebra o SSR/ISR do
//    cardápio público (ADR-0013). Mesmo assim a política bloqueia script de qualquer origem externa, `eval`,
//    `<object>`, `<base>` falso, formulário para fora e embutir o painel em outro site (clickjacking).
//  - `img-src https:`: imagens de produto/logo são URLs livres do lojista até o upload próprio (B12).
//    Quando o B12 entrar, trocar por `'self' data:` + o domínio do armazenamento.

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function wsOrigin(httpOrigin) {
  return httpOrigin ? httpOrigin.replace(/^http/, "ws") : null;
}

// Captcha do pedido público (NG-08): o widget do Cloudflare Turnstile carrega script e iframe de UMA origem fixa.
// Só entra na política quando a loja tem a chave do site configurada no build (sem chave, nada muda).
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export function buildCsp({ apiUrl, dev = false, turnstile = false } = {}) {
  const api = origin(apiUrl);
  const captcha = turnstile ? [TURNSTILE_ORIGIN] : [];
  const connect = ["'self'", api, wsOrigin(api), ...captcha].filter(Boolean);
  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...captcha],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": dev ? [...connect, "ws://localhost:*", "http://localhost:*"] : connect,
    "media-src": ["'self'"],
    ...(turnstile ? { "frame-src": [TURNSTILE_ORIGIN] } : {}),
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    ...(dev ? {} : { "upgrade-insecure-requests": [] }),
  };
  return Object.entries(directives)
    .map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

export function securityHeaders({ apiUrl, dev = false, turnstile = false } = {}) {
  const headers = [
    { key: "Content-Security-Policy", value: buildCsp({ apiUrl, dev, turnstile }) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  // HSTS só em produção: em desenvolvimento (http://localhost) prenderia o navegador em https.
  if (!dev) headers.push({ key: "Strict-Transport-Security", value: "max-age=15552000" });
  return headers;
}
