export const dynamic = "force-dynamic";

const STORE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WEBP_FILE = /^[a-f0-9-]{36}-\d{2,5}\.webp$/;

export async function GET(_request: Request, { params }: { params: { storeId: string; file: string } }) {
  const base = process.env.MEDIA_INTERNAL_URL;
  const { storeId, file } = params;
  if (process.env.NODE_ENV !== "development" || !base || !STORE_ID.test(storeId) || !WEBP_FILE.test(file)) {
    return new Response(null, { status: 404 });
  }

  try {
    const image = await fetch(`${base.replace(/\/+$/, "")}/stores/${storeId}/${file}`, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (image.status === 404) return new Response(null, { status: 404 });
    if (!image.ok || image.headers.get("content-type") !== "image/webp") return new Response(null, { status: 502 });
    return new Response(image.body, {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
