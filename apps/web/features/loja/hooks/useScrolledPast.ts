"use client";

import { useEffect, useState } from "react";

// O marcador chega como ELEMENTO (callback ref): ele só existe na tela do cardápio, não nas outras.
// `true` quando o marcador já passou por CIMA da tela (a identidade da loja saiu de vista ao rolar). Usa
// IntersectionObserver em vez de ouvir `scroll` (orçamento da spec 12 §8): o navegador só avisa na virada.
export function useScrolledPast(marker: Element | null): boolean {
  const [past, setPast] = useState(false);

  useEffect(() => {
    if (!marker) {
      // Marcador saiu da tela (detalhe/busca por cima): ao voltar a página começa sem barra fixa até medir de novo.
      setPast(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      // Fora da tela E acima: passou. Fora da tela e abaixo (página recarregada no meio) não conta como "passou".
      setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [marker]);

  return past;
}
