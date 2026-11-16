import type { Category } from "@/core/domain/storefront";

export function CategorySectionHeading({ category }: { category: { name: string; icon: string | null } }) {
  return (
    <h2 className="loja__section-title">
      {category.icon && <span>{category.icon}</span>}
      {category.name}
    </h2>
  );
}

export function CategoryChips({
  categories,
  activeCategoryId,
  onSelect,
  onViewAll,
}: {
  categories: Category[];
  activeCategoryId: string | null;
  onSelect: (id: string) => void;
  onViewAll: () => void;
}) {
  if (categories.length <= 1) return null;
  return (
    <>
      <div className="loja__categories-head">
        <span className="loja__categories-title">Categorias</span>
        <button onClick={onViewAll} className="loja__categories-all">
          Ver todas ›
        </button>
      </div>
      <nav className="loja__chips">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => onSelect(category.id)}
            className={`loja__chip${activeCategoryId === category.id ? " loja__chip--active" : ""}`}
          >
            {category.icon && <span className="loja__chip-icon">{category.icon}</span>}
            {category.name}
          </button>
        ))}
      </nav>
    </>
  );
}
