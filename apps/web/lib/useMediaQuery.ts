"use client";

import { useSyncExternalStore } from "react";

// Segue uma media query (ex.: "(min-width: 1100px)"). No servidor e sem matchMedia devolve `fallback`;
// o cliente corrige na hidratação e acompanha a mudança.
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}
