"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/shared/format/money";
import { prefersReducedMotion } from "@/lib/motion";
import type { PublicReel } from "./useReels";
import "./reels.css";

// REELS — modelo de cardápio estilo Reels: faixa de capas (como stories) e o feed vertical em tela cheia.
// Um vídeo toca por vez (o que está na tela), mudo até a pessoa tocar no som; "Pedir" abre o produto no MESMO cardápio
// (o carrinho é o da página, nada se perde).

export function ReelsStrip({ reels, onOpen }: { reels: PublicReel[]; onOpen: (index: number) => void }) {
  if (reels.length === 0) return null;
  return (
    <section className="reels-strip" aria-label="Pratos em vídeo">
      <h2 className="reels-strip__title">Veja em vídeo</h2>
      <ul className="reels-strip__list">
        {reels.map((reel, i) => (
          <li key={reel.id}>
            <button type="button" className="reels-strip__item" onClick={() => onOpen(i)} aria-label={`Ver vídeo: ${reel.product.name}`}>
              <img src={reel.posterUrl} alt="" loading="lazy" />
              <span>{reel.product.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReelSlide({ reel, active, near, muted, hint, onToggleSound, onOrder, closed }: { reel: PublicReel; active: boolean; near: boolean; muted: boolean; hint: boolean; onToggleSound: () => void; onOrder: () => void; closed: boolean }) {
  const [progress, setProgress] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (active) {
      el.currentTime = 0;
      void Promise.resolve(el.play()).catch(() => undefined); // navegador pode bloquear: a capa continua e o toque inicia
    } else el.pause();
  }, [active]);

  const price = reel.product.promoCents ?? reel.product.priceCents;
  return (
    <article className="reels-slide" aria-roledescription="vídeo" aria-label={reel.product.name}>
      <video
        ref={video}
        className="reels-slide__video"
        src={near ? reel.videoUrl : undefined /* o vizinho já carrega: troca sem espera */}
        poster={reel.posterUrl}
        muted={muted}
        loop
        playsInline
        preload={active ? "auto" : near ? "metadata" : "none"}
        onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
        onClick={onToggleSound}
      />
      <div className="reels-slide__progress" aria-hidden="true"><span style={{ transform: `scaleX(${active ? progress : 0})` }} /></div>
      <button type="button" className="reels-slide__sound" onClick={onToggleSound} aria-label={muted ? "Ligar o som" : "Desligar o som"}>
        {muted ? "🔇" : "🔊"}
      </button>
      {active && muted ? <button type="button" className="reels-slide__tap" onClick={onToggleSound}>Toque para ouvir</button> : null}
      {hint ? <div className="reels-slide__hint" aria-hidden="true">Deslize para cima para o próximo</div> : null}
      <div className="reels-slide__info">
        <h3>{reel.product.name}</h3>
        {reel.product.description ? <p>{reel.product.description}</p> : null}
        <div className="reels-slide__buy">
          <span className="reels-slide__price">
            {reel.product.promoCents !== null ? <s>{formatCents(reel.product.priceCents)}</s> : null} {formatCents(price)}
          </span>
          <button type="button" className="reels-slide__order" onClick={onOrder} disabled={reel.product.soldOut || closed}>
            {reel.product.soldOut ? "Esgotado" : closed ? "Loja fechada" : "Pedir"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ReelsViewer({ reels, startIndex, closed, onClose, onOrder }: { reels: PublicReel[]; startIndex: number; closed: boolean; onClose: () => void; onOrder: (productId: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(startIndex);
  const [muted, setMuted] = useState(true);
  const [moved, setMoved] = useState(false); // a dica de deslizar some no primeiro movimento
  useEffect(() => { if (active !== startIndex) setMoved(true); }, [active, startIndex]);

  // começa no vídeo tocado e acompanha qual está na tela (IntersectionObserver; nenhum ouvinte de scroll)
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    root.children[startIndex]?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
      },
      { root, threshold: 0.6 },
    );
    Array.from(root.children).forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [startIndex]);

  // Esc fecha; setas trocam de vídeo (teclado)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(0, Math.min(reels.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
        scroller.current?.children[next]?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [active, reels.length, onClose]);

  return (
    <div className="reels-viewer" role="dialog" aria-modal="true" aria-label="Pratos em vídeo">
      <button type="button" className="reels-viewer__close" onClick={onClose} aria-label="Voltar ao cardápio">✕</button>
      <div className="reels-viewer__scroller" ref={scroller}>
        {reels.map((reel, i) => (
          <div key={reel.id} data-index={i} className="reels-viewer__page">
            <ReelSlide reel={reel} active={i === active} near={Math.abs(i - active) <= 1} hint={i === active && !moved && reels.length > 1} muted={muted} closed={closed} onToggleSound={() => setMuted((m) => !m)} onOrder={() => onOrder(reel.product.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
