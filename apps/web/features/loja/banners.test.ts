import { describe, expect, it } from "vitest";
import type { Category, Product } from "@/core/domain/storefront";
import { bannerForStore, resolveBannerTarget } from "./banners";

const product: Product = {
  id: "pizza", name: "Pizza da casa", description: null, imageUrl: null, priceCents: 4500, additionals: [],
};
const categories: Category[] = [
  { id: "pizzas", name: "Pizzas", icon: null, products: [product] },
  { id: "vazia", name: "Sem produtos", icon: null, products: [] },
];

describe("banners opcionais por loja", () => {
  it("não cria campanha para loja sem configuração, incluindo nomes de propriedades do objeto", () => {
    for (const slug of ["sem-campanha", "toString", "constructor", "__proto__"]) {
      expect(bannerForStore(slug)).toBeUndefined();
    }
  });

  it("resolve somente categoria atual que contém produtos", () => {
    expect(resolveBannerTarget({ kind: "category", id: "pizzas" }, categories)).toEqual({ kind: "category", id: "pizzas" });
    expect(resolveBannerTarget({ kind: "category", id: "vazia" }, categories)).toBeUndefined();
    expect(resolveBannerTarget({ kind: "category", id: "removida" }, categories)).toBeUndefined();
  });

  it("devolve o produto do catálogo atual para abrir seu detalhe", () => {
    expect(resolveBannerTarget({ kind: "product", id: "pizza" }, categories)).toEqual({ kind: "product", product });
    expect(resolveBannerTarget({ kind: "product", id: "removido" }, categories)).toBeUndefined();
    expect(resolveBannerTarget({ kind: "product", id: "pizza" }, [])).toBeUndefined();
  });
});
