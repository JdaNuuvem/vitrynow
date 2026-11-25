import { describe, expect, it } from "vitest";
import { formatQty, unitCostLabel } from "@/core/domain/stock";
import { inputUnitOptions, toBaseQty } from "./quantity";

describe("estoque — conversão de quantidade (a API só recebe unidade base)", () => {
  it("kg/L viram g/ml; vírgula ou ponto decimal; milhar com ponto só quando há vírgula", () => {
    expect(toBaseQty("1,5", "G", "big")).toBe(1500);
    expect(toBaseQty("1.5", "G", "big")).toBe(1500);
    expect(toBaseQty("0,18", "G", "big")).toBe(180);
    expect(toBaseQty("180", "G", "base")).toBe(180);
    expect(toBaseQty("1.234,5", "G", "base")).toBe(1235);
    expect(toBaseQty("2", "ML", "big")).toBe(2000);
    expect(toBaseQty("3", "UN", "base")).toBe(3);
  });
  it("vazio, negativo ou texto é inválido", () => {
    for (const raw of ["", "  ", "-1", "abc"]) expect(toBaseQty(raw, "G", "base"), raw).toBeNull();
  });
  it("opções de unidade e formatação", () => {
    expect(inputUnitOptions("G").map((o) => o.label)).toEqual(["kg", "g"]);
    expect(inputUnitOptions("UN").map((o) => o.label)).toEqual(["un"]);
    expect(formatQty(1250, "G")).toBe("1,25 kg");
    expect(formatQty(300, "G")).toBe("300 g");
    expect(formatQty(-180, "G")).toBe("-180 g");
    expect(formatQty(12, "UN")).toBe("12 un");
    expect(unitCostLabel(4000, "G").replace(/\s/g, " ")).toBe("R$ 40,00/kg");
  });
});
