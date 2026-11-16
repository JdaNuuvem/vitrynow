import type { Product } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";

// Único lugar que sabe desenhar um produto na lista — usado pelo cardápio por categoria
// e pela tela de busca, pra manter os dois sempre visualmente idênticos.
export function ProductListItem({
  product,
  quantityInCart,
  onOpen,
  onQuickAdd,
}: {
  product: Product;
  quantityInCart: number;
  onOpen: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(product)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(product)}
      className="loja__item"
    >
      <div className="loja__item-row">
        <div className="loja__item-main">
          <div className="loja__item-name">{product.name}</div>
          <div className="loja__item-price">{formatCents(product.priceCents)}</div>
        </div>

        {product.imageUrl && (
          <div className="loja__item-media">
            <img src={product.imageUrl} alt={product.name} />
            <span
              onClick={(e) => {
                e.stopPropagation();
                onQuickAdd(product);
              }}
              className="loja__item-badge"
            >
              {quantityInCart > 0 ? quantityInCart : "+"}
            </span>
          </div>
        )}
      </div>

      {product.description && <div className="loja__item-desc">{product.description}</div>}
    </div>
  );
}
