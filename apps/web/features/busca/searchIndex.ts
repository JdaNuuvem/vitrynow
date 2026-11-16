import type { PanelRoute } from "@/core/navigation/panelNavigation";

export type SearchEntry = { id: string; label: string; href: string; icon: PanelRoute["icon"]; haystack: string };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function buildSearchIndex(routes: readonly PanelRoute[]): SearchEntry[] {
  return routes.map((route) => ({
    id: route.id,
    label: route.label,
    href: route.href,
    icon: route.icon,
    haystack: normalize([route.label, ...route.keywords].join(" ")),
  }));
}

export function searchEntries(index: readonly SearchEntry[], query: string): SearchEntry[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...index];
  return index.filter((entry) => terms.every((term) => entry.haystack.includes(term)));
}
