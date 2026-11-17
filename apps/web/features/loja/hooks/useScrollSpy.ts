"use client";

import { useEffect, useState } from "react";

// Qual seção está "em uso" enquanto a página rola, para destacar o chip da categoria (spec 09, barra sticky).
// Usa IntersectionObserver (nada de ouvir `scroll`): uma seção conta quando cruza a faixa logo abaixo do cabeçalho
// fixo. Entre as que cruzam, vale a primeira na ordem da página. Se nenhuma cruza (espaço entre seções), mantém a anterior.
export function useScrollSpy(sectionIds: string[], options: { topOffsetPx?: number } = {}): string | null {
  const { topOffsetPx = 0 } = options;
  const [activeId, setActiveId] = useState<string | null>(null);
  const key = sectionIds.join("|");

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    if (ids.length === 0 || typeof IntersectionObserver === "undefined") return;

    const crossing = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) crossing.add(entry.target.id);
          else crossing.delete(entry.target.id);
        }
        const first = ids.find((id) => crossing.has(id));
        if (first) setActiveId(first);
      },
      // faixa: do fim do cabeçalho até 55% da altura da tela (o resto, embaixo, não conta)
      { rootMargin: `-${topOffsetPx}px 0px -55% 0px` },
    );

    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key, topOffsetPx]);

  return activeId;
}
