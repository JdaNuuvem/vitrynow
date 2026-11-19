import type { CartLine, Product } from "@/core/domain/storefront";
import { lineChoicesValid, unitPriceWithChoices } from "./productOptions";

export type ProductsById = Map<string, Product>;

export function lineTotalCents(line: CartLine, productsById: ProductsById): number {
  const product = productsById.get(line.productId);
  if (!product) return 0;
  return unitPriceWithChoices(product, line) * line.quantity;
}

export function cartLineMustBeReviewed(line: CartLine, product?: Product) {
  return !product || !!product.soldOut || !!product.unavailableByOptions || !lineChoicesValid(product, line);
}

export function quoteCart(cart: CartLine[], productsById: ProductsById) {
  return cart.map((line) => {
    const product = productsById.get(line.productId);
    return product ? { ...line, expectedUnitPriceCents: unitPriceWithChoices(product, line) } : line;
  });
}

export function cartTotalCents(cart: CartLine[], productsById: ProductsById): number {
  return cart.reduce((sum, line) => sum + lineTotalCents(line, productsById), 0);
}

export function cartItemCount(cart: CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

export function quantityByProduct(cart: CartLine[]): Record<string, number> {
  return cart.reduce<Record<string, number>>((acc, line) => {
    acc[line.productId] = (acc[line.productId] ?? 0) + line.quantity;
    return acc;
  }, {});
}

export function isBelowMinOrder(totalCents: number, minOrderCents: number | null): boolean {
  return minOrderCents !== null && totalCents > 0 && totalCents < minOrderCents;
}

// Mesmas escolhas e observação somam uma linha até o limite aceito pela API.
export function addLine(cart: CartLine[], incoming: Omit<CartLine, "notes"> & { notes: string }): CartLine[] {
  const selections = incoming.optionSelections ?? [];
  const same = cart.find(
    (l) =>
      l.productId === incoming.productId &&
      l.quantity + incoming.quantity <= 100 &&
      l.additionalIds.length === incoming.additionalIds.length &&
      l.additionalIds.every((id) => incoming.additionalIds.includes(id)) &&
      (l.optionSelections?.length ?? 0) === selections.length &&
      selections.every(({ optionId, quantity }) => l.optionSelections?.some((entry) => entry.optionId === optionId && entry.quantity === quantity)) &&
      (l.notes ?? "") === incoming.notes,
  );
  if (same) return cart.map((l) => (l === same ? { ...l, quantity: l.quantity + incoming.quantity } : l));
  if (cart.length >= 100) return cart;
  return [...cart, { ...incoming, notes: incoming.notes || undefined }];
}

export function changeLineQuantity(cart: CartLine[], index: number, delta: number): CartLine[] {
  if (!cart[index]) return cart;
  const next = [...cart];
  const quantity = Math.min(100, next[index].quantity + delta);
  if (quantity <= 0) return next.filter((_, i) => i !== index);
  next[index] = { ...next[index], quantity };
  return next;
}
