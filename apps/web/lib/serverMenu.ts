import "server-only";
import { unstable_cache } from "next/cache";
import type { Menu } from "@/core/domain/storefront";

// Busca do cardápio no SERVIDOR (ADR-0013): pela rede interna, nunca exposta ao navegador, com
// cache curto. Roda só em Server Components; não importa nada de "use client".

// Segundos até o servidor do Next buscar o cardápio de novo. Curto: preço e disponibilidade
// mudam, e o servidor sempre recalcula o pedido de qualquer forma.
export const MENU_REVALIDATE_SECONDS = 30;

export type ServerMenuResult =
  | { status: "ok"; menu: Menu }
  | { status: "not-found" }
  // Loja SUSPENSA (API-09: 503 STORE_UNAVAILABLE, sem dados da loja): a página mostra só "indisponível".
  | { status: "suspended" }
  // API fora do ar ou erro 5xx: a página ainda abre e o navegador tenta buscar sozinho.
  | { status: "unavailable" };

// SEC-24: a chamada servidor-a-servidor se identifica à API com um segredo de serviço (variável de ambiente, nunca no
// código nem no navegador). Sem a variável não manda nada e a API usa o IP da conexão. O IP do visitante NÃO é
// repassado de propósito: ler `headers()` aqui tornaria a página dinâmica; a resposta guardada é a mesma para todos
// os visitantes e a API só é chamada na revalidação (≈ 1 chamada a cada 30 s por loja).
export const INTERNAL_SECRET_HEADER = "x-internal-service-secret";

export function internalApiUrl(): string {
  return (process.env.API_INTERNAL_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

// ST-41: o segredo só acompanha chamadas para um host INTERNO (loopback, rede privada, nome de serviço sem ponto,
// *.internal/*.local). Se a variável apontar para um endereço público, o cardápio ainda carrega, mas sem o segredo.
export function isInternalHost(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (host.includes(":")) return /^(fc|fd|fe80)/.test(host); // IPv6 privado/link-local
  return !host.includes(".") || host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".lan");
}

function internalHeaders(baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const secret = process.env.API_INTERNAL_SECRET;
  if (secret && isInternalHost(baseUrl)) headers[INTERNAL_SECRET_HEADER] = secret;
  return headers;
}

export function menuCacheTag(slug: string): string {
  return `menu:${slug}`;
}

// UMA busca à API, sem cache (o cache é do getMenuOnServer). `redirect: "error"` (ST-41): o Node mantém cabeçalhos
// personalizados num redirecionamento entre hosts, então um redirecionamento nunca é seguido com o segredo.
export async function fetchMenuOnServer(slug: string, fetchImpl: typeof fetch = fetch): Promise<ServerMenuResult> {
  try {
    const baseUrl = internalApiUrl();
    const response = await fetchImpl(`${baseUrl}/stores/${encodeURIComponent(slug)}/menu`, {
      headers: internalHeaders(baseUrl),
      cache: "no-store",
      redirect: "error",
    });
    // 404 = a loja não existe. 503 STORE_UNAVAILABLE = suspensa. Qualquer outro erro não prova nada disso.
    if (response.status === 404) return { status: "not-found" };
    if (response.status === 503) {
      const body = (await response.json().catch(() => null)) as { code?: string } | null;
      return body?.code === "STORE_UNAVAILABLE" ? { status: "suspended" } : { status: "unavailable" };
    }
    if (!response.ok) return { status: "unavailable" };
    const menu = (await response.json()) as Menu;
    if (!menu?.store || !Array.isArray(menu.categories)) return { status: "unavailable" };
    return { status: "ok", menu };
  } catch {
    return { status: "unavailable" };
  }
}

// ST-40: o cache guarda o RESULTADO tipado (ok | not-found | suspended), não a resposta HTTP. O cache de dados do Next
// só grava respostas 200 e, quando a revalidação volta 503/404, mantém a cópia velha (loja suspensa/removida seguia
// visível). Aqui "suspensa" e "não existe" são valores normais e substituem a cópia. Falha transitória (API fora,
// 5xx) lança: nada é gravado e a cópia anterior continua valendo até a API voltar.
export async function getMenuOnServer(slug: string): Promise<ServerMenuResult> {
  const cached = unstable_cache(
    async () => {
      const result = await fetchMenuOnServer(slug);
      if (result.status === "unavailable") throw new Error("cardápio indisponível");
      return result;
    },
    ["menu-ssr", slug],
    { revalidate: MENU_REVALIDATE_SECONDS, tags: [menuCacheTag(slug)] },
  );
  try {
    return await cached();
  } catch {
    return { status: "unavailable" };
  }
}

// og:image precisa de URL absoluta; texto livre da loja pode trazer qualquer coisa.
export function absoluteImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function storeDescription(menu: Menu): string {
  const { store, categories } = menu;
  const productCount = categories.reduce((sum, category) => sum + category.products.length, 0);
  const parts = [productCount > 0 ? `Veja o cardápio de ${store.name} e peça online.` : `Cardápio de ${store.name}.`];
  if (store.address) parts.push(store.address);
  if (store.openingHours) parts.push(store.openingHours);
  return parts.join(" · ").slice(0, 300);
}
