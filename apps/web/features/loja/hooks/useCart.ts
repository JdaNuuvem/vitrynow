import { useMemo, useState } from "react";
import type { CartLine, OptionSelection } from "@/core/domain/storefront";
import {
  addLine,
  cartItemCount,
  cartTotalCents,
  changeLineQuantity,
  lineTotalCents,
  quantityByProduct,
  type ProductsById,
} from "../cartPricing";

// Estado do carrinho; as contas (preço, soma de linhas) ficam em cartPricing.ts.
export function useCart(productsById: ProductsById) {
  const [cart, setCart] = useState<CartLine[]>([]);

  return {
    cart,
    add: (productId: string, quantity: number, additionalIds: string[], notes: string, optionSelections?: OptionSelection[]) =>
      setCart((prev) => addLine(prev, { productId, quantity, additionalIds, notes, ...(optionSelections?.length ? { optionSelections } : {}) })),
    edit: (index: number, choice: Pick<CartLine, "quantity" | "additionalIds" | "optionSelections" | "notes">) =>
      setCart((prev) => prev.map((line, current) => current === index ? { ...line, ...choice, optionSelections: choice.optionSelections } : line)),
    changeQuantity: (index: number, delta: number) => setCart((prev) => changeLineQuantity(prev, index, delta)),
    // "−" do cartão do produto: tira uma unidade da ÚLTIMA linha deste produto (a mais recente).
    removeOne: (productId: string) =>
      setCart((prev) => {
        const index = prev.map((line) => line.productId).lastIndexOf(productId);
        return index === -1 ? prev : changeLineQuantity(prev, index, -1);
      }),
    clear: () => setCart([]),
    lineTotalCents: (line: CartLine) => lineTotalCents(line, productsById),
    totalCents: cartTotalCents(cart, productsById),
    itemCount: cartItemCount(cart),
    quantityByProduct: useMemo(() => quantityByProduct(cart), [cart]),
  };
}
