"use client";

import { useEffect, useState } from "react";

// Qual seção está "em uso" enquanto a página rola, para destacar o chip da categoria (spec 12 §2.1, barra fixa).
// Usa IntersectionObserver (nada de ouvir `scroll`). A "faixa de leitura" é uma LINHA fina logo abaixo das barras fixas:
// as seções são contíguas, então só uma cruza a linha por vez, e o chip muda exatamente quando a seguinte chega ao topo.
//
// O observador só AVISA quando alguma seção troca de estado (chegou ou saiu da linha). Ele não diz onde estão as outras:
// um salto (voltar ao topo, tecla Home) pode pular seções curtas sem que elas cruzem a linha. Por isso, a cada aviso, a
// posição de TODAS as seções é lida de novo (getBoundingClientRect, só quando avisado, nunca a cada rolagem).
//
// `enabled`: a tela do cardápio só existe quando nenhuma outra (detalhe, busca, categorias) está por cima. Ao voltar,
// as seções são elementos NOVOS no DOM; sem religar, o observador seguiria nos antigos (já removidos). Quando `enabled`
// volta a ser verdadeiro, o efeito roda de novo e observa os elementos atuais.
//
// A linha é recalculada quando a altura da janela muda (evento de resize, não de rolagem).
export function useScrollSpy(sectionIds: string[], options: { topOffsetPx?: number; enabled?: boolean } = {}): string | null {
  const { topOffsetPx = 0, enabled = true } = options;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === "undefined" ? 0 : window.innerHeight));
  const key = sectionIds.join("|");

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    if (!enabled || ids.length === 0 || typeof IntersectionObserver === "undefined") return;

    const elements = ids.map((id) => document.getElementById(id));

    // Lê onde está a linha: a seção que a contém é a ativa; se a página está acima de todas, volta ao começo (null);
    // entre duas seções (espaço), mantém a anterior.
    const read = () => {
      for (let index = 0; index < ids.length; index++) {
        const rect = elements[index]?.getBoundingClientRect();
        if (rect && rect.top <= topOffsetPx && rect.bottom > topOffsetPx) return setActiveId(ids[index]);
      }
      const first = elements[0]?.getBoundingClientRect();
      if (first && first.top > topOffsetPx) setActiveId(null);
    };

    const observer = new IntersectionObserver(read, {
      // linha de 1 px: do fim das barras fixas até 1 px abaixo; o resto da janela, embaixo, não conta
      rootMargin: `-${topOffsetPx}px 0px -${Math.max(0, viewportHeight - topOffsetPx - 1)}px 0px`,
    });
    for (const element of elements) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [key, topOffsetPx, viewportHeight, enabled]);

  return activeId;
}
