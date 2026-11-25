import { describe, expect, it } from "vitest";
import type { Category, Product } from "@/core/domain/catalog";
import { categoryDeleteCopy, productDeleteCopy, productToInput } from "./deleteFlow";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Burger",
  description: null,
  imageUrl: null,
  priceCents: 2500,
  active: true,
  featured: true,
  additionals: [{ id: "a1", name: "Bacon", priceCents: 400 }],
  ...over,
});

describe("productToInput: ocultar sem perder nada", () => {
  it("mantém todos os campos e só troca o que o patch pede", () => {
    const input = productToInput(product(), "c1", { active: false });
    expect(input).toEqual({
      categoryId: "c1",
      name: "Burger",
      description: undefined,
      imageUrl: "",
      priceCents: 2500,
      featured: true,
      active: false,
      additionals: [{ id: "a1", name: "Bacon", priceCents: 400 }],
    });
  });

  it("sem patch devolve o produto como está", () => {
    expect(productToInput(product({ description: "Pão e carne", imageUrl: "https://x/f.png" }), "c1")).toMatchObject({
      description: "Pão e carne",
      imageUrl: "https://x/f.png",
      active: true,
    });
  });
});

describe("textos da exclusão", () => {
  it("produto ativo: ocultar é a ação principal (reversível) e excluir de vez é a segunda", () => {
    const copy = productDeleteCopy(product());
    expect(copy.confirmLabel).toBe("Ocultar do cardápio");
    expect(copy.confirmTone).toBe("primary");
    expect(copy.alternativeLabel).toBe("Excluir de vez");
    expect(copy.message).toContain("não dá para desfazer");
    expect(copy.informOnly).toBe(false);
  });

  it("produto oculto: o principal é excluir (danger) e não há alternativa", () => {
    const copy = productDeleteCopy(product({ active: false }));
    expect(copy.confirmTone).toBe("danger");
    expect(copy.alternativeLabel).toBeNull();
  });

  it("categoria com produtos só informa, com singular e plural certos", () => {
    const one = categoryDeleteCopy({ id: "c", name: "Bebidas", icon: null, products: [product()] } as Category);
    expect(one.informOnly).toBe(true);
    expect(one.message).toContain("1 produto, mesmo os ocultos.");
    expect(one.message).toContain("exclua o produto antes");
    expect(one.message).toContain("Mover produtos");
    // só indica a saída que funciona hoje: nada de "mova"/"oculte", que não destravam a exclusão
    expect(one.message).not.toMatch(/mova|oculte/i);
    const two = categoryDeleteCopy({ id: "c", name: "Bebidas", icon: null, products: [product(), product({ id: "p2" })] } as Category);
    expect(two.message).toContain("2 produtos, mesmo os ocultos.");
  });

  it("os dois textos de exclusão de produto avisam que pedidos antigos continuam com nome e preço", () => {
    for (const active of [true, false]) {
      expect(productDeleteCopy(product({ active })).message).toContain("Pedidos antigos continuam mostrando o nome e o preço.");
    }
  });

  it("categoria vazia pede confirmação de exclusão", () => {
    const copy = categoryDeleteCopy({ id: "c", name: "Bebidas", icon: null, products: [] } as Category);
    expect(copy.informOnly).toBe(false);
    expect(copy.confirmTone).toBe("danger");
  });

  it("nenhum texto mostra código de erro ou jargão", () => {
    for (const copy of [productDeleteCopy(product()), productDeleteCopy(product({ active: false })), categoryDeleteCopy({ id: "c", name: "x", icon: null, products: [] } as Category)]) {
      expect(`${copy.title} ${copy.message}`).not.toMatch(/[A-Z]{3,}_[A-Z_]+|HTTP|409/);
    }
  });
});
