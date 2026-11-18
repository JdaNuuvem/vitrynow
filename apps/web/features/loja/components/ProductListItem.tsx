import type { Product } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import { useBrokenImage } from "../hooks/useBrokenImage";
import { MinusIcon, PlusIcon } from "../icons";
import { quickAddMode } from "../storeInfo";

type Props = {
  product: Product;
  // Quantidade total deste produto no carrinho (soma de todas as linhas).
  quantityInCart: number;
  // Loja sem aceitar pedido (fechada, Consulta, Suspensão): o cartão abre o detalhe, mas não tem "+" (spec 12 §3 d).
  closed?: boolean;
  // Linha compacta (DV-V2-01): categoria com poucas fotos usa linha sem bloco de foto, "+" na direita.
  compact?: boolean;
  // Emoji da categoria: vira o desenho do bloco quando o produto não tem foto.
  categoryIcon?: string | null;
  onOpen: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
  // Stepper (produto sem adicionais): "−" tira uma unidade.
  onRemoveOne: (product: Product) => void;
};

// Único lugar que sabe desenhar um produto na lista (cardápio por categoria e busca): os dois ficam idênticos.
// Estrutura (spec 12 §3): o NOME é o botão principal e sua área de toque cobre o cartão inteiro (::after); o "+" é
// outro botão, por cima. Nunca um controle dentro de outro controle.
export function ProductListItem({ product, quantityInCart, closed = false, compact = false, categoryIcon = null, onOpen, onQuickAdd, onRemoveOne }: Props) {
  const mode = quickAddMode(product);
  const showAdd = !closed;
  const asStepper = showAdd && mode === "simple" && quantityInCart > 0;
  const hasOptions = mode === "options";

  return (
    <article className={`loja__item${compact ? " loja__item--compact" : ""}`}>
      <div className="loja__item-main">
        {/* data-product-id: é o que recebe o foco quando o detalhe fecha (WEB-22, F2) */}
        <button type="button" className="loja__item-name" data-product-id={product.id} onClick={() => onOpen(product)}>
          {product.name}
        </button>
        {product.description && <p className="loja__item-desc">{product.description}</p>}
        <p className="loja__item-price">{formatCents(product.priceCents)}</p>
        {hasOptions && <p className="loja__item-options">Tem opções</p>}
      </div>

      {!compact && <ProductMedia product={product} categoryIcon={categoryIcon} />}

      {showAdd && (
        <div className="loja__item-add">
          {asStepper ? (
            <div className="loja__stepper-card" role="group" aria-label={`Quantidade de ${product.name}`}>
              <button type="button" onClick={() => onRemoveOne(product)} aria-label={`Tirar um ${product.name}`}>
                <MinusIcon />
              </button>
              <b aria-label={`${quantityInCart} no carrinho`}>{quantityInCart}</b>
              <button type="button" onClick={() => onQuickAdd(product)} aria-label={`Mais um ${product.name}`}>
                <PlusIcon />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="loja__add-button"
              onClick={() => (mode === "detail" ? onOpen(product) : onQuickAdd(product))}
              aria-label={quantityInCart > 0 ? `Adicionar ${product.name} (${quantityInCart} no carrinho)` : `Adicionar ${product.name}`}
            >
              <span className="loja__add-dot">
                <PlusIcon />
              </span>
              {hasOptions && quantityInCart > 0 && (
                <span className="loja__add-count" aria-hidden="true">
                  {quantityInCart}
                </span>
              )}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

// Bloco da foto 112×112: com espaço reservado (zero salto de layout). Sem foto, ou com foto quebrada, vira "tinta" da
// cor da loja com o emoji da categoria; nunca ícone de imagem quebrada.
function ProductMedia({ product, categoryIcon }: { product: Product; categoryIcon: string | null }) {
  const image = useBrokenImage(product.imageUrl);
  const hasImage = Boolean(product.imageUrl) && !image.failed;
  return (
    <div className={`loja__item-media${hasImage ? "" : " loja__item-media--tint"}`}>
      {hasImage ? (
        // alt vazio: o nome do produto está ao lado
        <img ref={image.ref} src={product.imageUrl as string} alt="" loading="lazy" onError={image.onError} />
      ) : (
        <span className="loja__item-emoji" aria-hidden="true">
          {categoryIcon || "🍽️"}
        </span>
      )}
    </div>
  );
}
