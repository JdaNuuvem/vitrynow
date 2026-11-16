import { describe, expect, it } from "vitest";
import type { CartLine, Product } from "@/core/domain/storefront";
import {
  addLine,
  cartItemCount,
  cartTotalCents,
  changeLineQuantity,
  isBelowMinOrder,
  lineTotalCents,
  quantityByProduct,
  type ProductsById,
} from "./cartPricing";

const burger = {
  id: "p1",
  name: "Burger",
  priceCents: 2500,
  additionals: [
    { id: "a1", name: "Bacon", priceCents: 400 },
    { id: "a2", name: "Queijo", priceCents: 300 },
  ],
} as unknown as Product;
const soda = { id: "p2", name: "Refri", priceCents: 600, additionals: [] } as unknown as Product;
const products: ProductsById = new Map([
  ["p1", burger],
  ["p2", soda],
]);

const line = (over: Partial<CartLine> = {}): CartLine => ({ productId: "p1", quantity: 1, additionalIds: [], ...over });

describe("cartPricing", () => {
  it("total da linha = (produto + adicionais) x quantidade", () => {
    expect(lineTotalCents(line({ quantity: 2, additionalIds: ["a1", "a2"] }), products)).toBe((2500 + 400 + 300) * 2);
  });

  it("produto que saiu do cardápio vale 0 e adicional desconhecido é ignorado", () => {
    expect(lineTotalCents(line({ productId: "x" }), products)).toBe(0);
    expect(lineTotalCents(line({ additionalIds: ["nao-existe"] }), products)).toBe(2500);
  });

  it("soma o carrinho, conta itens e agrupa por produto", () => {
    const cart = [line({ quantity: 2 }), line({ productId: "p2", quantity: 3 }), line({ quantity: 1, additionalIds: ["a1"] })];
    expect(cartTotalCents(cart, products)).toBe(2500 * 2 + 600 * 3 + 2900);
    expect(cartItemCount(cart)).toBe(6);
    expect(quantityByProduct(cart)).toEqual({ p1: 3, p2: 3 });
  });

  it("carrinho vazio", () => {
    expect(cartTotalCents([], products)).toBe(0);
    expect(cartItemCount([])).toBe(0);
  });

  it("pedido mínimo: só bloqueia se há itens e o total está abaixo", () => {
    expect(isBelowMinOrder(1000, 2000)).toBe(true);
    expect(isBelowMinOrder(2000, 2000)).toBe(false);
    expect(isBelowMinOrder(0, 2000)).toBe(false);
    expect(isBelowMinOrder(1000, null)).toBe(false);
  });

  it("mesma escolha soma a quantidade; adicionais em outra ordem contam como a mesma", () => {
    let cart = addLine([], { productId: "p1", quantity: 1, additionalIds: ["a1", "a2"], notes: "" });
    cart = addLine(cart, { productId: "p1", quantity: 2, additionalIds: ["a2", "a1"], notes: "" });
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
  });

  it("observação diferente ou adicionais diferentes viram linhas separadas", () => {
    let cart = addLine([], { productId: "p1", quantity: 1, additionalIds: [], notes: "" });
    cart = addLine(cart, { productId: "p1", quantity: 1, additionalIds: [], notes: "sem cebola" });
    cart = addLine(cart, { productId: "p1", quantity: 1, additionalIds: ["a1"], notes: "" });
    expect(cart).toHaveLength(3);
    expect(cart[0].notes).toBeUndefined();
    expect(cart[1].notes).toBe("sem cebola");
  });

  it("alterar quantidade: soma, subtrai e remove a linha em zero sem mutar o original", () => {
    const original = [line({ quantity: 2 })];
    expect(changeLineQuantity(original, 0, 1)[0].quantity).toBe(3);
    expect(changeLineQuantity(original, 0, -1)[0].quantity).toBe(1);
    expect(changeLineQuantity(original, 0, -2)).toEqual([]);
    expect(changeLineQuantity(original, 0, -5)).toEqual([]);
    expect(original[0].quantity).toBe(2);
  });
});
