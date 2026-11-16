import { useState } from "react";
import type { Category, Product } from "@/core/domain/storefront";
import { CloseIcon, SearchIcon } from "../icons";
import { searchProducts } from "../productSearch";
import { ProductListItem } from "./ProductListItem";

// Tela cheia dedicada de busca (não é um filtro inline na lista) — igual ao padrão do
// original: digita, mostra o título de resultado e a lista de produtos que batem.
export function SearchScreen({
  categories,
  quantityByProduct,
  closed = false,
  onClose,
  onOpenProduct,
  onQuickAdd,
}: {
  categories: Category[];
  closed?: boolean;
  quantityByProduct: Record<string, number>;
  onClose: () => void;
  onOpenProduct: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
}) {
  const [term, setTerm] = useState("");
  const results = searchProducts(categories, term);
  const trimmed = term.trim();

  return (
    <main className="loja__screen">
      <div className="loja__screen-bar loja__screen-bar--gap">
        <span className="loja__search-lead">
          <SearchIcon size="md" />
        </span>
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Pesquisar..."
          aria-label="Pesquisar no cardápio"
          className="loja__search-input"
        />
        <button type="button" onClick={onClose} className="loja__close" aria-label="Fechar a busca e voltar ao cardápio">
          <CloseIcon />
        </button>
      </div>

      <div className="loja__screen-body loja__screen-body--results">
        {trimmed && (
          <p className="loja__results-title">
            Resultado para <br />&quot;{trimmed}&quot;:
          </p>
        )}
        <div className="loja__list">
          {results.map((product) => (
            <ProductListItem
              key={product.id}
              product={product}
              closed={closed}
              quantityInCart={quantityByProduct[product.id] ?? 0}
              onOpen={onOpenProduct}
              onQuickAdd={onQuickAdd}
            />
          ))}
        </div>
        {trimmed && results.length === 0 && <p className="loja__empty-center">Nenhum item encontrado.</p>}
      </div>
    </main>
  );
}
