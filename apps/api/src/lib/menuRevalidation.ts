import { prisma } from "@meucardapio/db";

// Revalidação sob demanda da vitrine (API-58, ADR-0013 §2.4): quando preço, visibilidade, esgotado, horário ou a
// situação da loja mudam, o web refaz a página em ≤ 5 s em vez de esperar o TTL do ISR. A chamada é INTERNA
// (rede do compose), com segredo compartilhado; nunca passa pelo Caddy.

export type RevalidateConfig = { url: string; secret: string };

/** Sem as duas variáveis a revalidação fica desligada (dev e testes): nada é gravado nem chamado. */
export function revalidateConfig(env: NodeJS.ProcessEnv = process.env): RevalidateConfig | null {
  const url = env.WEB_INTERNAL_URL?.trim().replace(/\/+$/, "");
  const secret = env.REVALIDATE_SECRET?.trim();
  return url && secret ? { url, secret } : null;
}

let fetchImpl: typeof fetch = (...args) => fetch(...args);
/** Só para testes: troca o transporte HTTP. Sem argumento, volta ao `fetch` global. */
export function setRevalidateFetch(impl?: typeof fetch) {
  fetchImpl = impl ?? ((...args) => fetch(...args));
}

export const REVALIDATE_TIMEOUT_MS = 3000;
export const REVALIDATE_MAX_ATTEMPTS = 8;
// Recuo entre tentativas (segundos): a vitrine tem o TTL de segurança, então não insistimos para sempre.
const BACKOFF_SECONDS = [2, 5, 15, 60, 300, 900, 1800];

export const revalidateBackoffMs = (attempts: number) => BACKOFF_SECONDS[Math.min(Math.max(attempts, 1), BACKOFF_SECONDS.length) - 1] * 1000;

/** Faz a chamada ao web. Lança se o web não confirmar (o job reenvia). O segredo nunca vai para log nem para a URL. */
export async function callWebRevalidate(slug: string, config: RevalidateConfig): Promise<void> {
  const response = await fetchImpl(`${config.url}/api/revalidate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-revalidate-secret": config.secret },
    body: JSON.stringify({ slug }),
    signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`web respondeu ${response.status}`);
}

/**
 * Pede a revalidação da vitrine da loja. Várias mudanças seguidas viram UMA linha pendente (por slug) e uma chamada.
 * Devolve `false` quando a revalidação está desligada ou a loja não existe.
 */
export async function scheduleMenuRevalidation(storeId: string, db = prisma): Promise<boolean> {
  if (!revalidateConfig()) return false;
  const store = await db.store.findUnique({ where: { id: storeId }, select: { slug: true } });
  if (!store) return false;
  const now = new Date();
  await db.menuRevalidation.upsert({
    where: { slug: store.slug },
    create: { slug: store.slug, storeId, requestedAt: now, nextAttemptAt: now },
    update: { storeId, requestedAt: now, nextAttemptAt: now, attempts: 0 },
  });
  return true;
}
