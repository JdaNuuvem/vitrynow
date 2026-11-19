import { useCallback, useEffect, useRef, useState } from "react";

// Imagem que falhou: some o ícone de imagem quebrada e a tela cai no fallback (spec 09 §2.1).
//
// O `onError` sozinho NÃO basta: a página vem renderizada do servidor (ADR-0013), então o
// navegador pode terminar de falhar o carregamento ANTES de o React hidratar, e o evento já
// passou. Por isso, depois de montar, conferimos `complete && naturalWidth === 0`.
// O estado fica amarrado ao `src`: trocar a URL dá uma nova chance, e uma URL ruim não faz loop.
export function useBrokenImage(src: string | null | undefined) {
  const ref = useRef<HTMLImageElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(src) && failedSrc === src;

  useEffect(() => {
    const img = ref.current;
    if (src && img && img.complete && img.naturalWidth === 0) setFailedSrc(src);
    // M-11 (fade da foto): só uma imagem que AINDA carrega ao hidratar fica transparente até o `load`. A que já veio
    // pronta do servidor (SSR) nunca é escondida, para não piscar nem atrasar o LCP; sem JS também aparece.
    if (!src || !img || img.complete) return;
    img.setAttribute("data-loading", "");
    const done = () => img.removeAttribute("data-loading");
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    return () => {
      img.removeEventListener("load", done);
      img.removeEventListener("error", done);
      img.removeAttribute("data-loading");
    };
  }, [src]);

  const onError = useCallback(() => setFailedSrc(src ?? null), [src]);
  return { ref, failed, onError };
}
