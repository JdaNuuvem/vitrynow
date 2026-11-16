import type { CartLine, Product } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import { isBelowMinOrder } from "../cartPricing";
import { STORE_CLOSED_MESSAGE } from "../checkoutForm";

export function CartDrawer({
  cart,
  productsById,
  lineTotalCents,
  totalCents,
  minOrderCents,
  closed,
  totalLabel,
  onChangeQuantity,
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
  onClose: () => void;
  onContinue: () => void;
}) {
  const belowMinOrder = isBelowMinOrder(totalCents, minOrderCents);

  return (
    <div className="loja__sheet" onClick={onClose}>
      <div className="loja__sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="loja__sheet-head">
          <h2 className="loja__sheet-title">Seu carrinho</h2>
          <button onClick={onClose} className="loja__sheet-close">
            fechar
          </button>
        </div>

        {cart.length === 0 ? (
          <p className="loja__muted">Carrinho vazio.</p>
        ) : (
          <div className="loja__cart-lines">
            {cart.map((line, index) => {
              const product = productsById.get(line.productId);
              if (!product) return null;
              return (
                <div key={index} className="loja__cart-line">
                  <div className="loja__cart-info">
                    <div className="loja__cart-name">{product.name}</div>
                    {line.additionalIds.length > 0 && (
                      <div className="loja__cart-sub">
                        {line.additionalIds
                          .map((id) => product.additionals.find((a) => a.id === id)?.name)
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    )}
                    {line.notes && <div className="loja__cart-sub loja__cart-sub--notes">&quot;{line.notes}&quot;</div>}
                    <div className="loja__cart-sub">{formatCents(lineTotalCents(line))}</div>
                  </div>
                  <div className="loja__cart-stepper">
                    <button onClick={() => onChangeQuantity(index, -1)} className="loja__round">
                      −
                    </button>
                    <span className="loja__cart-qty">{line.quantity}</span>
                    <button onClick={() => onChangeQuantity(index, 1)} className="loja__round">
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {belowMinOrder && (
          <p className="loja__warning">
            Faltam {formatCents(minOrderCents! - totalCents)} para o pedido mínimo de {formatCents(minOrderCents!)}.
          </p>
        )}

        {closed && <p className="loja__warning">{STORE_CLOSED_MESSAGE}.</p>}

        <div className="loja__total">
          <span>{totalLabel}</span>
          <span>{formatCents(totalCents)}</span>
        </div>

        <button onClick={onContinue} disabled={cart.length === 0 || belowMinOrder || closed} className="loja__cta loja__cta--spaced">
          Continuar
        </button>
      </div>
    </div>
  );
}
