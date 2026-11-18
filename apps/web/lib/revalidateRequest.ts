import { timingSafeEqual } from "node:crypto";
import { menuCacheTag } from "@/lib/serverMenu";

// Lógica da rota POST /api/revalidate (API-58, ADR-0013 §2.4), separada do Next para ser testável: a API chama,
// pela rede INTERNA, com o segredo compartilhado, quando preço/visibilidade/esgotado/horário da loja mudam.
// O Caddy nunca encaminha /api/revalidate ao web (`/api/*` vai para a API), então ela não é alcançável de fora.

// Slug como a API grava (letras minúsculas, números e hífen); recusa qualquer coisa fora disso antes de virar tag.
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RevalidateDeps = { secret: string | undefined; revalidateTag: (tag: string) => void };

export async function handleRevalidate(request: Request, { secret, revalidateTag }: RevalidateDeps): Promise<Response> {
  // Sem segredo configurado a rota fica FECHADA (nunca aberta por esquecimento).
  if (!secret || !sameSecret(request.headers.get("x-revalidate-secret"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  if (!SLUG.test(slug)) return Response.json({ error: "invalid slug" }, { status: 400 });
  revalidateTag(menuCacheTag(slug));
  return Response.json({ revalidated: true, tag: menuCacheTag(slug) });
}
