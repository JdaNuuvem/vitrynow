import { describe, expect, it } from "vitest";
import { detailItemTotal } from "./orderDetail";

// Convenção da API (RN-B8-03): unitPriceCents já inclui variação e opções SUM; só o adicional LEGADO fica fora.
describe("detailItemTotal", () => {
  it("opção SUM já está no unitário: não soma de novo (pizza G 6000 + borda 800, qtd 3 = 20400)", () => {
    const item = { quantity: 3, unitPriceCents: 6800, additionals: [], options: [{ groupName: "Borda", name: "Catupiry", priceCents: 800, quantity: 1, priceMode: "SUM" as const }] };
    expect(detailItemTotal(item)).toBe(20400);
  });
  it("adicional legado soma por cima do unitário", () => {
    expect(detailItemTotal({ quantity: 2, unitPriceCents: 1000, additionals: [{ name: "Bacon", priceCents: 300 }], options: [] })).toBe(2600);
  });
  it("sem opções nem adicionais: unitário × quantidade", () => {
    expect(detailItemTotal({ quantity: 4, unitPriceCents: 1250 })).toBe(5000);
  });
});
