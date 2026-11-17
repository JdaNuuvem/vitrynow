import type { CSSProperties } from "react";

// Bloco de carregamento. Decorativo (`aria-hidden`): quem anuncia "carregando" é o conjunto (ver MenuSkeleton).
// O brilho é CSS puro (motion.css) e some em movimento reduzido.
export function Skeleton({ width, height, radius }: { width?: string | number; height?: string | number; radius?: string | number }) {
  const style = { width, height, "--loja-skeleton-radius": typeof radius === "number" ? `${radius}px` : radius } as CSSProperties;
  return <span className="loja__skeleton" style={style} aria-hidden="true" />;
}

// Forma aproximada do cardápio (capa, nome da loja, chips e alguns produtos) para a espera da 1ª carga,
// com UM aviso para leitor de tela em vez de dezenas de blocos mudos.
export function MenuSkeleton({ products = 4 }: { products?: number }) {
  return (
    <div className="loja__skeleton-menu" role="status" aria-busy="true">
      <span className="loja__visually-hidden">Carregando o cardápio…</span>
      <Skeleton height={160} radius={0} />
      <Skeleton width="60%" height={24} />
      <Skeleton width="85%" height={16} />
      {Array.from({ length: products }, (_, index) => (
        <Skeleton key={index} height={96} radius={12} />
      ))}
    </div>
  );
}
