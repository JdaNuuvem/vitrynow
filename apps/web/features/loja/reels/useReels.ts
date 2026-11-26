"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

// REELS (cardápio estilo Reels): vídeos publicados pela loja, cada um ligado a um produto. Lista vazia = a faixa nem aparece.
export type PublicReel = {
  id: string;
  videoUrl: string;
  posterUrl: string;
  durationMs: number | null;
  product: { id: string; name: string; description: string | null; priceCents: number; promoCents: number | null; imageUrl: string | null; soldOut: boolean };
};

export function useReels(slug: string, enabled: boolean) {
  const [reels, setReels] = useState<PublicReel[]>([]);
  useEffect(() => {
    if (!enabled) return; // sem vídeo publicado: nenhuma chamada (o cardápio do servidor basta, ADR-0013)
    let alive = true;
    void apiFetch(`/stores/${encodeURIComponent(slug)}/reels`)
      .then((r) => (r.ok ? r.json() : { reels: [] }))
      .then((data: { reels?: PublicReel[] }) => alive && setReels(Array.isArray(data.reels) ? data.reels : []))
      .catch(() => undefined); // vídeo é extra: falhou, o cardápio segue igual
    return () => {
      alive = false;
    };
  }, [slug, enabled]);
  return reels;
}
