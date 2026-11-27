"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Category, Product } from "@/core/domain/storefront";
import { prefersReducedMotion } from "@/lib/motion";
import { startingPrice } from "../productOptions";
import type { PublicReel } from "./useReels";
import "./reels-menu.css";

// MODELO DE CARDÁPIO "REELS": o cardápio inteiro como feed vertical em tela cheia (um prato por tela, deslizando).
// Vídeo quando o prato tem Reel publicado; senão a foto com movimento suave; abas de categoria no topo.
// Carrinho, detalhe e checkout são os MESMOS do cardápio clássico (a página só troca a lista por este feed).

type Slide = { product: Product; category: Category; reel: PublicReel | null };

function SlideMedia({ slide, active, near, muted, onToggleSound }: { slide: Slide; active: boolean; near: boolean; muted: boolean; onToggleSound: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (active) void Promise.resolve(el.play()).catch(() => undefined);
    else el.pause();
  }, [active]);

  if (slide.reel) {
    return (
      <video
        ref={video}
        className="reels-menu__media"
        src={near ? slide.reel.videoUrl : undefined}
        poster={slide.reel.posterUrl}
        muted={muted}
        loop
        playsInline
        preload={active ? "auto" : near ? "metadata" : "none"}
        onClick={onToggleSound}
      />
    );
  }
  if (slide.product.imageUrl) {
    return <img className={`reels-menu__media reels-menu__photo${active ? " reels-menu__photo--active" : ""}`} src={slide.product.imageUrl} alt="" loading={near ? "eager" : "lazy"} />;
  }
  return (
    <div className="reels-menu__media reels-menu__placeholder" aria-hidden="true">
      <span>{slide.product.name.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

export function ReelsMenu({ storeName, logoUrl, categories, reels, quantityByProduct, closed, onAdd, onOpen, onShowList, startIndex = 0, onIndexChange }: {
  storeName: string;
  logoUrl: string | null;
  categories: Category[];
  reels: PublicReel[];
  quantityByProduct: Record<string, number>;
  closed: boolean;
  onAdd: (product: Product) => void;
  onOpen: (product: Product) => void;
  onShowList: () => void;
  /** volta ao prato onde estava (ao fechar o detalhe o feed é montado de novo) */
  startIndex?: number;
  onIndexChange?: (index: number) => void;
}) {
  const slides = useMemo<Slide[]>(() => {
    const byProduct = new Map(reels.map((r) => [r.product.id, r]));
    // pratos com vídeo primeiro dentro de cada categoria (chamam mais atenção); a ordem do dono vale entre os demais
    return categories.flatMap((category) =>
      [...category.products]
        .sort((a, b) => Number(byProduct.has(b.id)) - Number(byProduct.has(a.id)))
        .map((product) => ({ product, category, reel: byProduct.get(product.id) ?? null })),
    );
  }, [categories, reels]);
  const firstOfCategory = useMemo(() => {
    const m = new Map<string, number>();
    slides.forEach((s, i) => { if (!m.has(s.category.id)) m.set(s.category.id, i); });
    return m;
  }, [slides]);

  const scroller = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(startIndex);
  const [muted, setMuted] = useState(true);
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => { for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index)); },
      { root, threshold: 0.6 },
    );
    Array.from(root.children).forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [slides.length]);

  useEffect(() => { if (active > 0) setHint(false); onIndexChange?.(active); }, [active, onIndexChange]);
  // posição inicial sem animação
  useEffect(() => { if (startIndex > 0) scroller.current?.children[startIndex]?.scrollIntoView?.({ behavior: "auto" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a aba da categoria atual fica visível na faixa de abas
  const activeCategory = slides[active]?.category.id;
  useEffect(() => {
    chips.current?.querySelector<HTMLElement>(`[data-cat="${activeCategory}"]`)?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activeCategory]);

  const goTo = (index: number) => scroller.current?.children[index]?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth" });

  if (slides.length === 0) {
    return <div className="reels-menu reels-menu--empty" role="status">Este cardápio ainda não tem produtos.</div>;
  }

  return (
    <section className="reels-menu" aria-label={`Cardápio de ${storeName}`} aria-roledescription="feed de pratos">
      <header className="reels-menu__top">
        <div className="reels-menu__brand">
          {logoUrl ? <img src={logoUrl} alt="" /> : null}
          <strong>{storeName}</strong>
          <button type="button" className="reels-menu__list-btn" onClick={onShowList}>Ver em lista</button>
        </div>
        <div className="reels-menu__chips" ref={chips} role="tablist" aria-label="Categorias">
          {categories.map((c) => (
            <button key={c.id} type="button" role="tab" data-cat={c.id} aria-selected={c.id === activeCategory} className="reels-menu__chip" onClick={() => goTo(firstOfCategory.get(c.id) ?? 0)}>
              {c.name}
            </button>
          ))}
        </div>
      </header>

      <div className="reels-menu__scroller" ref={scroller}>
        {slides.map((slide, i) => {
          const p = slide.product;
          const inCart = quantityByProduct[p.id] ?? 0;
          const unavailable = p.soldOut || p.unavailableByOptions;
          return (
            <article key={p.id} data-index={i} className="reels-menu__slide" aria-label={p.name}>
              <SlideMedia slide={slide} active={i === active} near={Math.abs(i - active) <= 1} muted={muted} onToggleSound={() => setMuted((m) => !m)} />
              {slide.reel ? (
                <button type="button" className="reels-menu__sound" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Ligar o som" : "Desligar o som"}>{muted ? "🔇" : "🔊"}</button>
              ) : null}
              <div className="reels-menu__info">
                <span className="reels-menu__cat">{slide.category.name}</span>
                <h3>{p.name}</h3>
                {p.description ? <p>{p.description}</p> : null}
                <div className="reels-menu__buy">
                  <span className="reels-menu__price">{p.soldOut ? "Esgotado" : startingPrice(p)}</span>
                  <div className="reels-menu__actions">
                    <button type="button" className="reels-menu__more" onClick={() => onOpen(p)}>Detalhes</button>
                    <button type="button" className="reels-menu__add" disabled={unavailable || closed} onClick={() => onAdd(p)} aria-label={`Adicionar ${p.name}`}>
                      {closed ? "Fechado" : inCart ? `Adicionar (${inCart})` : "Adicionar"}
                    </button>
                  </div>
                </div>
              </div>
              {i === 0 && hint && slides.length > 1 ? <div className="reels-menu__hint" aria-hidden="true">Deslize para ver o próximo prato</div> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
