import type { Product } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";

// Único lugar que sabe desenhar um produto na lista — usado pelo cardápio por categoria
// e pela tela de busca, pra manter os dois sempre visualmente idênticos.
export function ProductListItem({
  product,
  quantityInCart,
  closed = false,
  onOpen,
  onQuickAdd,
}: {
  product: Product;
  quantityInCart: number;
  // Loja fechada: sem o "+" de adicionar rápido (spec 09 §2.4).
  closed?: boolean;
  onOpen: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-product-id={product.id}
      onClick={() => onOpen(product)}
      onKeyDown={(e) => {
        // role="button" promete Enter e Espaço (o Espaço também não pode rolar a página).
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(product);
        }
      }}
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
            {!closed && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickAdd(product);
                }}
                className="loja__item-badge"
              >
                {quantityInCart > 0 ? quantityInCart : "+"}
              </span>
            )}
          </div>
        )}
      </div>

      {product.description && <div className="loja__item-desc">{product.description}</div>}
    </div>
  );
}
