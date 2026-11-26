export const dynamic = "force-dynamic";

// Proxy de DESENVOLVIMENTO (S3Mock) dos Reels: em produção o Caddy serve /media direto do disco.
// Repassa o cabeçalho Range: o navegador busca o vídeo em pedaços (206) para começar a tocar sem baixar tudo.
const STORE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MP4 = /^[a-f0-9-]{36}\.mp4$/;
const POSTER = /^[a-f0-9-]{36}-poster\.webp$/;

export async function GET(request: Request, { params }: { params: { storeId: string; file: string } }) {
  const base = process.env.MEDIA_INTERNAL_URL;
  const { storeId, file } = params;
  const type = MP4.test(file) ? "video/mp4" : POSTER.test(file) ? "image/webp" : null;
  if (process.env.NODE_ENV !== "development" || !base || !STORE_ID.test(storeId) || !type) return new Response(null, { status: 404 });

  const range = request.headers.get("range");
  try {
    const media = await fetch(`${base.replace(/\/+$/, "")}/stores/${storeId}/reels/${file}`, {
      redirect: "error",
      headers: range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {},
      signal: AbortSignal.timeout(20000),
    });
    if (media.status === 404) return new Response(null, { status: 404 });
    if (!media.ok) return new Response(null, { status: 502 });
    const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "Accept-Ranges": "bytes" };
    for (const h of ["content-length", "content-range"]) {
      const v = media.headers.get(h);
      if (v) headers[h] = v;
    }
    return new Response(media.body, { status: media.status, headers });
  } catch {
    return new Response(null, { status: 502 });
  }
}
