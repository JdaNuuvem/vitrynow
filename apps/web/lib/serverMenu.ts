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
// ---------------------------------------------------------------------------------------------------------------
// Proteções do cache (SEC-25/SEC-26). O slug vem da URL PÚBLICA: cada valor distinto poderia criar uma entrada de cache
// e uma chamada à API. Por isso: (1) formato validado ANTES de tocar o cache ou a API; (2) "não existe" de um slug que
// nunca foi visto como loja NÃO é gravado no cache em disco do Next, só lembrado em memória por pouco tempo e com teto;
// (3) falha transitória fica ~5 s sem chamar a API; (4) a cópia boa só vale até MAX_STALE_SECONDS sem revalidar.
// ---------------------------------------------------------------------------------------------------------------

// Mesmo formato do cadastro da loja (SEC-26): fora disso nem chega à API.
export const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/;
export const isValidSlug = (slug: string) => SLUG_PATTERN.test(slug);

// Cache NEGATIVO curto (decisão do Atlas): durante uma queda da API cada visita, depois do TTL, refaria a chamada. Por
// isso, depois de uma falha transitória a loja fica NEGATIVE_CACHE_SECONDS sem chamar a API. A guarda fica DENTRO da
// função em cache: ela lança sem buscar, o Next não grava nada e a última cópia boa continua sendo servida (o cache
// negativo só guarda "a API caiu"; nunca a substitui). É memória do processo e limitada em tamanho.
export const NEGATIVE_CACHE_SECONDS = 5;
// "Não existe" de slug desconhecido: lembrado em memória por este tempo (sem gravar em disco, sem chamar a API).
export const MISSING_MEMORY_SECONDS = 30;
// Teto de obsolescência: se a revalidação falha de forma transitória (500, 429, API fora) a cópia boa vale até esta
// idade; depois a página falha FECHADA em "Loja indisponível", sem dados, em vez de servir a cópia velha para sempre.
export const MAX_STALE_SECONDS = 600;
const MEMORY_MAX_ENTRIES = 500;

const failedUntil = new Map<string, number>();
const missingUntil = new Map<string, number>();
const seenOk = new Set<string>(); // lojas que já responderam 200 neste processo (podem ter cópia boa guardada)

function fresh(map: Map<string, number>, slug: string, now: number): boolean {
  const until = map.get(slug);
  if (until === undefined) return false;
  if (until > now) return true;
  map.delete(slug);
  return false;
}

function remember(map: Map<string, number>, slug: string, now: number, seconds: number) {
  if (map.size >= MEMORY_MAX_ENTRIES) {
    for (const [key, until] of map) if (until <= now) map.delete(key);
    if (map.size >= MEMORY_MAX_ENTRIES) return; // cheio de entradas recentes: não cresce mais
  }
  map.set(slug, now + seconds * 1000);
}

function rememberOk(slug: string) {
  if (seenOk.size >= MEMORY_MAX_ENTRIES) seenOk.delete(seenOk.values().next().value as string);
  seenOk.add(slug);
}

// Só para testes.
export function resetServerMenuState() {
  failedUntil.clear();
  missingUntil.clear();
  seenOk.clear();
}

// Resultado que é devolvido à página mas NÃO deve ser gravado: o Next só grava o que a função retorna.
class NotStored extends Error {
  constructor(readonly result: ServerMenuResult) {
    super("resultado não gravado no cache");
  }
}

type CachedResult = ServerMenuResult & { fetchedAt: number };

// ST-40: o cache guarda o RESULTADO tipado (ok, not-found ou suspended), não a resposta HTTP. O cache de dados do Next
// só grava respostas 200 e, quando a revalidação volta 503/404, mantém a cópia velha (loja suspensa/removida seguia
// visível). Aqui "suspensa" e "não existe" são valores normais e substituem a cópia. Falha transitória (API fora,
// 5xx, 429) lança: nada é gravado e a cópia anterior continua valendo, até MAX_STALE_SECONDS de idade.
export async function getMenuOnServer(slug: string): Promise<ServerMenuResult> {
  if (!isValidSlug(slug)) return { status: "not-found" }; // sem cache e sem chamada à API
  if (fresh(missingUntil, slug, Date.now())) return { status: "not-found" };

  const cached = unstable_cache(
    async (): Promise<CachedResult> => {
      const started = Date.now();
      if (fresh(failedUntil, slug, started)) throw new Error("cardápio indisponível (cache negativo)");
      const result = await fetchMenuOnServer(slug);
      if (result.status === "unavailable") {
        remember(failedUntil, slug, Date.now(), NEGATIVE_CACHE_SECONDS);
        throw new Error("cardápio indisponível");
      }
      if (result.status === "ok") rememberOk(slug);
      if (result.status === "not-found" && !seenOk.has(slug)) {
        // slug que nunca foi loja aqui: não vira entrada em disco; só memória curta
        remember(missingUntil, slug, Date.now(), MISSING_MEMORY_SECONDS);
        throw new NotStored(result);
      }
      return { ...result, fetchedAt: Date.now() };
    },
    ["menu-ssr", slug],
    { revalidate: MENU_REVALIDATE_SECONDS, tags: [menuCacheTag(slug)] },
  );
  try {
    const { fetchedAt, ...result } = await cached();
    // cópia boa velha demais (a revalidação vem falhando): falha fechada, sem dados da loja
    if (result.status === "ok" && fetchedAt !== undefined && Date.now() - fetchedAt > MAX_STALE_SECONDS * 1000) return { status: "suspended" };
    return result;
  } catch (error) {
    if (error instanceof NotStored) return error.result;
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
