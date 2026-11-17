import { describe, expect, it } from "vitest";
import type { Category, Product } from "@/core/domain/storefront";
import { conditionsLine, isCompactCategory, quickAddMode } from "./storeInfo";

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
