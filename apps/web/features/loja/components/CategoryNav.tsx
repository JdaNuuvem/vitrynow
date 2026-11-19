import { useEffect, useRef } from "react";
import type { Category } from "@/core/domain/storefront";
import { scrollBehavior } from "@/lib/motion";
import { SearchIcon } from "../icons";
import { useBrokenImage } from "../hooks/useBrokenImage";
import { Icon } from "@/shared/icons/Icon";

export function CategorySectionHeading({ category }: { category: { name: string; icon: string | null } }) {
  return (
    <h2 className="loja__section-title">
      {category.icon && <span aria-hidden="true">{category.icon}</span>}
      {category.name}
    </h2>
  );
}

type StickyIdentity = { name: string; logoUrl: string | null; initials: string };

function CategoryThumbnail({ category }: { category: Category }) {
  const src = category.products.find((product) => product.imageUrl)?.imageUrl;
  const image = useBrokenImage(src ?? null);
  if (src && !image.failed) {
    return <img ref={image.ref} src={src} className="loja__chip-photo" loading="lazy" width={24} height={24} alt="" onError={image.onError} />;
  }
  return category.icon ? <span className="loja__chip-icon" aria-hidden="true">{category.icon}</span> : null;
}

// Barra de categorias (spec 12 §2.1). Fica fixa no topo ao rolar; o chip da categoria que está na tela fica
// destacado (scrollspy) e é trazido para dentro da linha. Em telas largas (≥ 800 px), quando a identidade sai de vista,
// o próprio sticky vira UMA linha: logo + nome + chips + buscar. O scrollspy nunca move o foco.
export function CategoryChips({
  categories,
  activeCategoryId,
  stuck,
  identity,
  onSelect,
  onSelectAll,
  onOpenSearch,
}: {
  categories: Category[];
  activeCategoryId: string | null;
  // A identidade da loja já saiu de vista: a barra está fixa.
  stuck: boolean;
  identity: StickyIdentity;
  onSelect: (id: string) => void;
  onSelectAll?: () => void;
  onOpenSearch: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Traz o chip ativo para dentro da linha rolável. Só mexe na rolagem
  // horizontal da própria linha: nunca na da página, e nunca no foco.
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || !chip) return;
    const target = Math.max(0, chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2);
    // Suave (M-03), exceto para quem pediu menos movimento (scrollBehavior devolve "auto").
    if (typeof row.scrollTo === "function") row.scrollTo({ left: target, behavior: scrollBehavior() });
    else row.scrollLeft = target;
  }, [activeCategoryId]);

  if (categories.length <= 1) return null;
  return (
    <nav className={`loja__chipsbox${stuck ? " loja__chipsbox--stuck" : ""}`} aria-label="Categorias">
      <div className="loja__stick-id" aria-hidden="true">
        {identity.logoUrl ? <img src={identity.logoUrl} alt="" /> : <span className="loja__stick-logo">{identity.initials}</span>}
        <span className="loja__stick-name">{identity.name}</span>
      </div>
      <div className="loja__chips" ref={rowRef}>
        {onSelectAll && (
          <button type="button" onClick={onSelectAll} aria-current={activeCategoryId === null ? "true" : undefined}
            className={`loja__chip${activeCategoryId === null ? " loja__chip--active" : ""}`}>
            <span className="loja__chip-body"><Icon name="products" size={22} />Tudo</span>
          </button>
        )}
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category.id)}
            aria-current={activeCategoryId === category.id ? "true" : undefined}
            className={`loja__chip${activeCategoryId === category.id ? " loja__chip--active" : ""}`}
          >
            <span className="loja__chip-body">
              <CategoryThumbnail category={category} />
              {category.name}
            </span>
          </button>
        ))}
      </div>
      <button type="button" className="loja__stick-search" onClick={onOpenSearch} aria-label="Pesquisar no cardápio" tabIndex={stuck ? 0 : -1}>
        <SearchIcon size="md" />
      </button>
    </nav>
  );
}

// Barra superior de 56 px (celular): aparece quando a identidade sai de vista, com logo + nome + buscar. Em ≥ 800 px
// ela some e a identidade vai para dentro da barra de categorias (uma linha só).
export function StickyBar({ visible, identity, onOpenSearch }: { visible: boolean; identity: StickyIdentity; onOpenSearch: () => void }) {
  return (
    <header className={`loja__bar${visible ? " loja__bar--on" : ""}`} aria-hidden={visible ? undefined : "true"}>
      <div className="loja__bar-in">
        {identity.logoUrl ? <img className="loja__bar-logo" src={identity.logoUrl} alt="" /> : <span className="loja__bar-logo loja__bar-logo--initials">{identity.initials}</span>}
        <span className="loja__bar-name">{identity.name}</span>
        <button type="button" className="loja__stick-search" onClick={onOpenSearch} aria-label="Pesquisar no cardápio" tabIndex={visible ? 0 : -1}>
          <SearchIcon size="md" />
        </button>
      </div>
    </header>
  );
}
