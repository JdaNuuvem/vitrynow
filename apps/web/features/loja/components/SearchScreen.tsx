import type { Category, Product } from "@/core/domain/storefront";
import { SearchIcon } from "../icons";
import { searchProducts } from "../productSearch";
import { ProductListItem } from "./ProductListItem";

export function SearchResults({
  categories, term, closed, quantityByProduct, onOpenProduct, onQuickAdd, onRemoveOne, onClear,
}: {
  categories: Category[];
  term: string;
  closed: boolean;
  quantityByProduct: Record<string, number>;
  onOpenProduct: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
  onRemoveOne: (product: Product) => void;
  onClear: () => void;
}) {
  const query = term.trim();
  const results = query ? searchProducts(categories, query) : categories.flatMap((category) => category.products);

  return (
    <section className="loja__section" aria-label="Busca no cardápio">
      <h2 className="loja__section-title">{query ? `Resultados para “${query}”` : "Itens do cardápio"}</h2>
      {results.length ? (
        <div className="loja__list">
          {results.map((product) => (
            <ProductListItem key={product.id} product={product} closed={closed}
              quantityInCart={quantityByProduct[product.id] ?? 0} onOpen={onOpenProduct}
              onQuickAdd={onQuickAdd} onRemoveOne={onRemoveOne} />
          ))}
        </div>
      ) : (
        <div className="loja__empty-search">
          <span aria-hidden="true"><SearchIcon size="lg" /></span>
          <p role="status">Nenhum item encontrado.</p>
          {query && <button type="button" onClick={onClear}>Limpar busca</button>}
        </div>
      )}
    </section>
  );
}
