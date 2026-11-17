"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion";

const MAX_STAGGER = 7; // no máximo 8 cartões em cascata por entrada (spec 12 §8, M-01); do 9º em diante entram juntos

// M-01: o cartão sobe 10 px e aparece, na PRIMEIRA vez que entra na tela. Só mexe nos cartões que estão ABAIXO da
// dobra ao hidratar: o HTML do servidor (SSR/ISR) já mostra tudo, e esconder o que já está à vista faria o cartão
// piscar. Usa IntersectionObserver (nenhum ouvinte de rolagem) e só `transform`/`opacity` via CSS (motion.css):
// o JS apenas marca `data-reveal` ("pre" escondido, "in" entrando) e o atraso da cascata (`--reveal-i`).
// Quem pediu menos movimento não recebe nada (o cartão nunca fica escondido).
export function useRevealOnEnter(enabled: boolean) {
  // Cartões já revelados (por id do produto): ao voltar do detalhe a tela remonta e eles não animam de novo.
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;

    const idOf = (card: HTMLElement) => card.querySelector("[data-product-id]")?.getAttribute("data-product-id") ?? "";
    const below = Array.from(document.querySelectorAll<HTMLElement>(".loja__item")).filter(
      (card) => card.getBoundingClientRect().top > window.innerHeight && !seen.current.has(idOf(card)),
    );
    if (below.length === 0) return;
    for (const card of below) card.setAttribute("data-reveal", "pre");

    const observer = new IntersectionObserver(
      (entries) => {
        let position = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const card = entry.target as HTMLElement;
          card.style.setProperty("--reveal-i", String(Math.min(position++, MAX_STAGGER)));
          card.setAttribute("data-reveal", "in");
          seen.current.add(idOf(card));
          observer.unobserve(card);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const card of below) observer.observe(card);

    return () => {
      observer.disconnect();
      // desmontou (outra tela por cima) com cartões ainda escondidos: não deixa nenhum preso em "pre"
      for (const card of below) card.removeAttribute("data-reveal");
    };
  }, [enabled]);
}
