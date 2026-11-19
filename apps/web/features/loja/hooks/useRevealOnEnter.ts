"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion";

const MAX_STAGGER = 7; // no máximo 8 cartões em cascata por entrada (spec 12 §8, M-01); do 9º em diante entram juntos

// Rede de segurança (condição de merge do Atlas, R1 da Da Vinci): conteúdo invisível é pior do que animação perdida.
// O IntersectionObserver só dispara quando o navegador renderiza quadros; em aba em segundo plano, aparelho lento ou
// depois de um salto grande (tocar num chip distante, voltar ao topo) o aviso pode demorar, e o cartão ficaria em
// branco. Um cartão que já está na tela e continua escondido depois de VISIBLE_GRACE_MS é mostrado SEM animação. Um
// relógio simples confere os cartões ainda escondidos (não é ouvinte de rolagem) e para quando não resta nenhum.
const VISIBLE_GRACE_MS = 600;
const CHECK_EVERY_MS = 250;

// M-01: o cartão sobe 10 px e aparece, na PRIMEIRA vez que entra na tela. Só mexe nos cartões que estão ABAIXO da
// dobra ao hidratar: o HTML do servidor (SSR/ISR) já mostra tudo, e esconder o que já está à vista faria o cartão
// piscar. Usa IntersectionObserver (nenhum ouvinte de rolagem) e só `transform`/`opacity` via CSS (motion.css): o JS
// apenas marca `data-reveal` ("pre" escondido, "in" entrando com animação, "shown" mostrado sem animação) e o atraso
// da cascata (`--reveal-i`). Quem pediu menos movimento não recebe nada (o cartão nunca fica escondido).
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

    const pending = new Set(below);
    const visibleSince = new Map<HTMLElement, number>();
    let timer: number | undefined;

    const settle = (card: HTMLElement, mode: "in" | "shown", position = 0) => {
      if (mode === "in") card.style.setProperty("--reveal-i", String(Math.min(position, MAX_STAGGER)));
      card.setAttribute("data-reveal", mode);
      seen.current.add(idOf(card));
      pending.delete(card);
      visibleSince.delete(card);
      observer.unobserve(card);
      if (pending.size === 0 && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        let position = 0;
        for (const entry of entries) {
          if (entry.isIntersecting && pending.has(entry.target as HTMLElement)) settle(entry.target as HTMLElement, "in", position++);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const card of below) observer.observe(card);

    // Rede de segurança: na tela há mais de VISIBLE_GRACE_MS e ainda escondido → aparece na hora, sem animação.
    timer = window.setInterval(() => {
      const now = Date.now();
      for (const card of Array.from(pending)) {
        const rect = card.getBoundingClientRect();
        const onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
        if (!onScreen) {
          visibleSince.delete(card);
          continue;
        }
        const since = visibleSince.get(card) ?? now;
        visibleSince.set(card, since);
        if (now - since >= VISIBLE_GRACE_MS) settle(card, "shown");
      }
    }, CHECK_EVERY_MS);

    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearInterval(timer);
      // desmontou (outra tela por cima) com cartões ainda escondidos: não deixa nenhum preso em "pre"
      for (const card of below) card.removeAttribute("data-reveal");
    };
  }, [enabled]);
}
