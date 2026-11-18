import { revalidateTag } from "next/cache";
import { handleRevalidate } from "@/lib/revalidateRequest";

// Chamada só pela API, pela rede interna (API-58). O segredo vem de REVALIDATE_SECRET (o mesmo da API).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRevalidate(request, { secret: process.env.REVALIDATE_SECRET, revalidateTag });
}
