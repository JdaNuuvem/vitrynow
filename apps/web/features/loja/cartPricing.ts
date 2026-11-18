import type { CartLine, Product } from "@/core/domain/storefront";

export type ProductsById = Map<string, Product>;

export function lineTotalCents(line: CartLine, productsById: ProductsById): number {
  const product = productsById.get(line.productId);
  if (!product) return 0;
  const additionalsCents = line.additionalIds.reduce(
    (sum, id) => sum + (product.additionals.find((a) => a.id === id)?.priceCents ?? 0),
    0,
  );
  return (product.priceCents + additionalsCents) * line.quantity;
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

// Mesma escolha (produto + adicionais + observação) soma a quantidade em vez de duplicar a linha.
export function addLine(cart: CartLine[], incoming: Omit<CartLine, "notes"> & { notes: string }): CartLine[] {
  const same = cart.find(
    (l) =>
      l.productId === incoming.productId &&
      l.additionalIds.length === incoming.additionalIds.length &&
      l.additionalIds.every((id) => incoming.additionalIds.includes(id)) &&
      (l.notes ?? "") === incoming.notes,
  );
  if (same) return cart.map((l) => (l === same ? { ...l, quantity: l.quantity + incoming.quantity } : l));
  return [...cart, { ...incoming, notes: incoming.notes || undefined }];
}

export function changeLineQuantity(cart: CartLine[], index: number, delta: number): CartLine[] {
  const next = [...cart];
  const quantity = next[index].quantity + delta;
  if (quantity <= 0) return next.filter((_, i) => i !== index);
  next[index] = { ...next[index], quantity };
  return next;
}
