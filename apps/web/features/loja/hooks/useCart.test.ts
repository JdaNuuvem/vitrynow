import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Product } from "@/core/domain/storefront";
import { useCart } from "./useCart";

const burger = {
  id: "p1",
  name: "Burger",
  priceCents: 2500,
  additionals: [{ id: "a1", name: "Bacon", priceCents: 400 }],
} as unknown as Product;
const soda = { id: "p2", name: "Refri", priceCents: 600, additionals: [] } as unknown as Product;
const products = new Map([
  ["p1", burger],
  ["p2", soda],
]);

describe("useCart", () => {
  it("começa vazio", () => {
    const { result } = renderHook(() => useCart(products));
    expect(result.current.cart).toEqual([]);
    expect(result.current.itemCount).toBe(0);
    expect(result.current.totalCents).toBe(0);
  });

  it("adiciona, soma o total e conta os itens", () => {
    const { result } = renderHook(() => useCart(products));
    act(() => result.current.add("p1", 2, ["a1"], ""));
    act(() => result.current.add("p2", 1, [], "gelada"));
    expect(result.current.itemCount).toBe(3);
    expect(result.current.totalCents).toBe((2500 + 400) * 2 + 600);
    expect(result.current.quantityByProduct).toEqual({ p1: 2, p2: 1 });
  });

  it("a mesma escolha soma a quantidade em vez de duplicar a linha", () => {
    const { result } = renderHook(() => useCart(products));
    act(() => result.current.add("p1", 1, [], ""));
    act(() => result.current.add("p1", 2, [], ""));
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].quantity).toBe(3);
  });

  it("alterar a quantidade soma, subtrai e remove a linha ao chegar a zero", () => {
    const { result } = renderHook(() => useCart(products));
    act(() => result.current.add("p2", 2, [], ""));
    act(() => result.current.changeQuantity(0, 1));
    expect(result.current.cart[0].quantity).toBe(3);
    act(() => result.current.changeQuantity(0, -3));
    expect(result.current.cart).toEqual([]);
  });

  it("limpar esvazia o carrinho", () => {
    const { result } = renderHook(() => useCart(products));
    act(() => result.current.add("p1", 1, [], ""));
    act(() => result.current.clear());
    expect(result.current.cart).toEqual([]);
    expect(result.current.totalCents).toBe(0);
  });

  it("produto que saiu do cardápio vale 0 no total", () => {
    const { result } = renderHook(() => useCart(products));
    act(() => result.current.add("fantasma", 1, [], ""));
    expect(result.current.totalCents).toBe(0);
    expect(result.current.itemCount).toBe(1);
  });
});
