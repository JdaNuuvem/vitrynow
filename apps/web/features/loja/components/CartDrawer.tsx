import type { CartLine, Product } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { cartLineMustBeReviewed, isBelowMinOrder } from "../cartPricing";
import { choiceLabels, lineChoicesValid } from "../productOptions";
import { STORE_CLOSED_MESSAGE } from "../checkoutForm";
import { useBrokenImage } from "../hooks/useBrokenImage";
import { MinusIcon, PlusIcon, TrashIcon } from "../icons";
import { Sheet } from "./Sheet";

function CartThumbnail({ product }: { product?: Product }) {
  const image = useBrokenImage(product?.imageUrl);
  return (
    <div className="loja__cart-photo" aria-hidden="true">
      {product?.imageUrl && !image.failed ? (
        <img ref={image.ref} src={product.imageUrl} alt="" onError={image.onError} loading="lazy" width={70} height={70} />
      ) : <Icon name="products" size={28} />}
    </div>
  );
}

export function CartDrawer({
  cart,
  productsById,
  lineTotalCents,
  totalCents,
  minOrderCents,
  closed,
  totalLabel,
  onChangeQuantity,
  onEdit,
  onClose,
  onContinue,
}: {
  cart: CartLine[];
  productsById: Map<string, Product>;
  lineTotalCents: (line: CartLine) => number;
  totalCents: number;
  minOrderCents: number | null;
  closed: boolean;
  // "Subtotal" quando há taxa de entrega (o total final só aparece no checkout).
  totalLabel: string;
  onChangeQuantity: (index: number, delta: number) => void;
  onEdit?: (index: number, product: Product) => void;
  onClose: () => void;
  onContinue: () => void;
}) {
  const belowMinOrder = isBelowMinOrder(totalCents, minOrderCents);
  const unavailable = cart.some((line) => cartLineMustBeReviewed(line, productsById.get(line.productId)));

  return (
    <Sheet title="Seu carrinho" onClose={onClose} purchase>
      {cart.length === 0 ? (
        <div className="loja__cart-empty">
          <Icon name="orders" size={36} />
          <p>Carrinho vazio.</p>
          <button type="button" className="loja__empty-menu-link" onClick={onClose}>Ver cardápio</button>
        </div>
      ) : (
        <ul className="loja__cart-lines" aria-label="Itens do carrinho">
          {cart.map((line, index) => {
            const product = productsById.get(line.productId);
            const name = product?.name ?? "Item removido do cardápio";
            const choices = product ? choiceLabels(product, line) : [];
            const needsEdit = product && !product.soldOut && !product.unavailableByOptions && !lineChoicesValid(product, line);
            const canEdit = !!onEdit && product && !product.soldOut && !product.unavailableByOptions && !closed;
            return (
              <li key={index} className="loja__cart-line">
                <CartThumbnail product={product} />
                <div className="loja__cart-info">
                  <div className="loja__cart-name">{name}</div>
                  {product?.unavailableByOptions ? <p className="loja__cart-unavailable">Opções indisponíveis</p> : product?.soldOut && <p className="loja__cart-unavailable">Esgotado</p>}
                  {choices.length > 0 && <div className="loja__cart-sub">{choices.join(" · ")}</div>}
                  {line.notes && <div className="loja__cart-sub loja__cart-sub--notes">&quot;{line.notes}&quot;</div>}
                  {needsEdit && <p className="loja__cart-unavailable">As opções mudaram. Edite este item para continuar.</p>}
                  {canEdit && <button className="loja__item-edit" type="button" aria-label={`Editar ${name}`} onClick={() => onEdit(index, product)}>Editar</button>}
                </div>
                <button
                  type="button" className="loja__icon-btn loja__cart-remove" aria-label={`Remover ${name}`}
                  onClick={() => onChangeQuantity(index, -line.quantity)}
                ><TrashIcon /></button>
                {product && <strong className="loja__cart-price">{formatCents(lineTotalCents(line))}</strong>}
                <div className="loja__cart-stepper">
                  <button
                    type="button"
                    onClick={() => onChangeQuantity(index, -1)}
                    className="loja__round"
                    aria-label={`Diminuir quantidade de ${name}`}
                  >
                    <MinusIcon />
                  </button>
                  <span className="loja__cart-qty" aria-label={`Quantidade: ${line.quantity}`} role="status">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeQuantity(index, 1)}
                    className="loja__round"
                    disabled={cartLineMustBeReviewed(line, product) || closed || line.quantity >= 100}
                    aria-label={`Aumentar quantidade de ${name}`}
                  >
                    <PlusIcon />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {belowMinOrder && (
        <p className="loja__warning">
          Faltam {formatCents(minOrderCents! - totalCents)} para o pedido mínimo de {formatCents(minOrderCents!)}.
        </p>
      )}

      {closed && <p className="loja__warning">{STORE_CLOSED_MESSAGE}.</p>}
      {unavailable && <p className="loja__warning" role="status">
        {cart.some(line => { const item = productsById.get(line.productId); return item && !item.soldOut && !item.unavailableByOptions && !lineChoicesValid(item, line); })
          ? "Revise as opções ou remova os itens indisponíveis para continuar."
          : "Remova os itens indisponíveis para continuar."}
      </p>}

      <div className="loja__cart-summary">
        <h3 className="loja__summary-title">Resumo do pedido</h3>
        <p className="loja__summary-row"><span>Quantidade de itens</span><span>{cart.reduce((sum, line) => sum + line.quantity, 0)}</span></p>
        <div className="loja__summary-row loja__summary-row--total">
          <span>{totalLabel}</span><strong>{formatCents(totalCents)}</strong>
        </div>
      </div>

      <button type="button" onClick={onContinue} disabled={cart.length === 0 || belowMinOrder || closed || unavailable} className="loja__cta loja__cta--spaced">
        Continuar
      </button>
    </Sheet>
  );
}
