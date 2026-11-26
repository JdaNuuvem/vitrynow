export const dynamic = "force-dynamic";

const STORE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WEBP_FILE = /^[a-f0-9-]{36}-\d{2,5}\.webp$/;
const GLB_FILE = /^3d-[a-f0-9-]{36}\.glb$/; // prato 3D

export async function GET(_request: Request, { params }: { params: { storeId: string; file: string } }) {
  const base = process.env.MEDIA_INTERNAL_URL;
  const { storeId, file } = params;
  const type = WEBP_FILE.test(file) ? "image/webp" : GLB_FILE.test(file) ? "model/gltf-binary" : null;
  if (process.env.NODE_ENV !== "development" || !base || !STORE_ID.test(storeId) || !type) {
    return new Response(null, { status: 404 });
  }

  try {
    const media = await fetch(`${base.replace(/\/+$/, "")}/stores/${storeId}/${file}`, {
      redirect: "error",
      signal: AbortSignal.timeout(type === "image/webp" ? 5000 : 20000),
    });
    if (media.status === 404) return new Response(null, { status: 404 });
    if (!media.ok || media.headers.get("content-type") !== type) return new Response(null, { status: 502 });
    return new Response(media.body, {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
