import type { Menu } from "@/core/domain/storefront";

// Busca do cardápio no SERVIDOR (ADR-0013): pela rede interna, nunca exposta ao navegador, com
// cache ISR curto. Roda só em Server Components; não importa nada de "use client".

// Segundos até o servidor do Next buscar o cardápio de novo. Curto: preço e disponibilidade
// mudam, e o servidor sempre recalcula o pedido de qualquer forma.
export const MENU_REVALIDATE_SECONDS = 30;

export type ServerMenuResult =
  | { status: "ok"; menu: Menu }
  | { status: "not-found" }
  // API fora do ar ou erro 5xx: a página ainda abre e o navegador tenta buscar sozinho.
  | { status: "unavailable" };

export function internalApiUrl(): string {
  return (process.env.API_INTERNAL_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

// SEC-24: a chamada servidor-a-servidor se identifica à API com um segredo de serviço (variável de ambiente, nunca no
// código nem no navegador). Sem a variável não manda nada e a API usa o IP da conexão. O IP do visitante NÃO é
// repassado de propósito: ler `headers()` aqui tornaria a página dinâmica e acabaria com o cache ISR; a resposta
// guardada é a mesma para todos os visitantes e a API só é chamada na revalidação (≈ 1 chamada a cada 30 s por loja).
export const INTERNAL_SECRET_HEADER = "x-internal-service-secret";

function internalHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const secret = process.env.API_INTERNAL_SECRET;
  if (secret) headers[INTERNAL_SECRET_HEADER] = secret;
  return headers;
}

export function menuCacheTag(slug: string): string {
  return `menu:${slug}`;
}

export async function fetchMenuOnServer(slug: string, fetchImpl: typeof fetch = fetch): Promise<ServerMenuResult> {
  try {
    const response = await fetchImpl(`${internalApiUrl()}/stores/${encodeURIComponent(slug)}/menu`, {
      headers: internalHeaders(),
      next: { revalidate: MENU_REVALIDATE_SECONDS, tags: [menuCacheTag(slug)] },
    });
    // 404 = a loja não existe. Qualquer outro erro não prova isso, então não vira 404.
    if (response.status === 404) return { status: "not-found" };
    if (!response.ok) return { status: "unavailable" };
    const menu = (await response.json()) as Menu;
    if (!menu?.store || !Array.isArray(menu.categories)) return { status: "unavailable" };
    return { status: "ok", menu };
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
