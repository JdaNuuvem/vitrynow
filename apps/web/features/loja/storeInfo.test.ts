import { describe, expect, it } from "vitest";
import type { Category, Product } from "@/core/domain/storefront";
import { activeCategoryId, conditionsLine, isCompactCategory, quickAddMode } from "./storeInfo";

const store = (over: Partial<Parameters<typeof conditionsLine>[0]> = {}) => ({ minOrderCents: 2000, deliveryEnabled: true, pickupEnabled: true, deliveryFeeCents: 600, ...over });

describe("linha 'Mínimo · Entrega · Retirada' (spec 12 §2.4)", () => {
  it("completa", () => {
    expect(conditionsLine(store())).toMatch(/^Mínimo R\$\s?20,00 · Entrega R\$\s?6,00 · Retirada$/);
  });

  it("cada trecho só aparece se existir", () => {
    expect(conditionsLine(store({ minOrderCents: null }))).toMatch(/^Entrega R\$\s?6,00 · Retirada$/);
    expect(conditionsLine(store({ deliveryEnabled: false }))).toMatch(/^Mínimo R\$\s?20,00 · Retirada$/);
    expect(conditionsLine(store({ pickupEnabled: false }))).toMatch(/^Mínimo R\$\s?20,00 · Entrega R\$\s?6,00$/);
  });

  it("taxa zero com entrega ligada vira 'Entrega grátis'; sem nada cadastrado a linha some", () => {
    expect(conditionsLine(store({ deliveryFeeCents: 0 }))).toContain("Entrega grátis");
    expect(conditionsLine(store({ minOrderCents: null, deliveryEnabled: false, pickupEnabled: false }))).toBe("");
  });

  it("pedido mínimo zero ainda é um mínimo informado", () => {
    expect(conditionsLine(store({ minOrderCents: 0 }))).toMatch(/^Mínimo R\$\s?0,00/);
  });
});

const product = (imageUrl: string | null, additionals: unknown[] = []) => ({ id: Math.random().toString(), imageUrl, additionals }) as unknown as Product;
const category = (...photos: (string | null)[]) => ({ products: photos.map((photo) => product(photo)) }) as Pick<Category, "products">;

describe("linha compacta (DV-V2-01)", () => {
  it("menos da metade com foto → compacta", () => {
    expect(isCompactCategory(category("a.png", null, null))).toBe(true);
    expect(isCompactCategory(category(null, null))).toBe(true);
  });

  it("exatamente a metade ainda usa o bloco de foto", () => {
    expect(isCompactCategory(category("a.png", null))).toBe(false);
    expect(isCompactCategory(category("a.png", "b.png", null, null))).toBe(false);
  });

  it("maioria com foto → cartão com bloco", () => {
    expect(isCompactCategory(category("a.png", "b.png", null))).toBe(false);
    expect(isCompactCategory(category("a.png"))).toBe(false);
  });

  it("categoria vazia não é compacta (e nem aparece)", () => {
    expect(isCompactCategory(category())).toBe(false);
  });
});

describe("regra do '+' (spec 12 §3, Leonardo)", () => {
  it("sem adicionais: adiciona 1 e vira stepper", () => {
    expect(quickAddMode({ additionals: [] })).toBe("simple");
  });

  it("só adicionais opcionais: adiciona 1 unidade simples, com 'Tem opções'", () => {
    expect(quickAddMode({ additionals: [{ id: "a1" }] as never })).toBe("options");
  });

  it("com grupo obrigatório (quando o contrato trouxer): o '+' abre o detalhe", () => {
    expect(quickAddMode({ additionals: [], requiredGroups: [{ id: "g1" }] })).toBe("detail");
    expect(quickAddMode({ additionals: [{ id: "a1" }] as never, requiredGroups: [{ id: "g1" }] })).toBe("detail");
  });
});

describe("chip destacado (parecer da Da Vinci, B1/A1)", () => {
  const ids = ["lanches", "pizzas", "porcoes", "bebidas"];

  it("acima da primeira seção (topo) é SEMPRE a primeira categoria, sem pino nem valor guardado", () => {
    expect(activeCategoryId({ ids, spy: null, pinned: null, atEnd: false })).toBe("lanches");
  });

  it("B1: depois de tocar a última e subir, o pino já caiu (atEnd falso) e o topo volta à primeira, nunca à tocada", () => {
    expect(activeCategoryId({ ids, spy: null, pinned: null, atEnd: false })).toBe("lanches");
    // mesmo que sobrasse um pino, fora do fim ele não vale
    expect(activeCategoryId({ ids, spy: null, pinned: "bebidas", atEnd: false })).toBe("lanches");
    expect(activeCategoryId({ ids, spy: "pizzas", pinned: "bebidas", atEnd: false })).toBe("pizzas");
  });

  it("chip tocado com a página parada no fim: o tocado fica destacado", () => {
    expect(activeCategoryId({ ids, spy: "porcoes", pinned: "bebidas", atEnd: true })).toBe("bebidas");
  });

  it("A1: no fim da página, rolando (sem toque), a ÚLTIMA categoria é a destacada", () => {
    expect(activeCategoryId({ ids, spy: "porcoes", pinned: null, atEnd: true })).toBe("bebidas");
  });

  it("cardápio curto que cabe na tela: o fim está à vista desde o início, mas o destaque é o da PRIMEIRA", () => {
    expect(activeCategoryId({ ids: ["lanches", "bebidas"], spy: null, pinned: null, atEnd: true })).toBe("lanches");
  });

  it("no meio da página vale a leitura da rolagem", () => {
    expect(activeCategoryId({ ids, spy: "porcoes", pinned: null, atEnd: false })).toBe("porcoes");
  });

  it("pino de categoria que não existe mais é ignorado; sem categorias não há destaque", () => {
    expect(activeCategoryId({ ids, spy: "pizzas", pinned: "sumiu", atEnd: true })).toBe("bebidas");
    expect(activeCategoryId({ ids: [], spy: null, pinned: null, atEnd: true })).toBeNull();
  });
});
