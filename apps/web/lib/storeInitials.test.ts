import { describe, expect, it } from "vitest";
import { storeInitials } from "./storeInitials";

describe("storeInitials (spec 09 §2.2)", () => {
  it.each([
    ["Pizzaria Boa Massa", "PB"],
    ["Zé", "Z"],
    ["Casa do Açaí", "CA"],
    ["Bar e Restaurante da Maria", "BR"],
    ["  espaço   extra  ", "EE"],
    ["açaí do Zé", "AZ"],
    ["De Da", "DD"],
    ["", ""],
  ])("%s -> %s", (name, expected) => {
    expect(storeInitials(name)).toBe(expected);
  });

  it("ignora pontuação no começo da palavra e aceita emoji/valores nulos sem quebrar", () => {
    expect(storeInitials("(Bar) do Zé")).toBe("BZ");
    expect(storeInitials(null)).toBe("");
    expect(storeInitials(undefined)).toBe("");
    expect(storeInitials("😀 Burger")).not.toBe("");
  });

  it("usa no máximo duas letras", () => {
    expect(storeInitials("Uma Loja Com Muitos Nomes").length).toBeLessThanOrEqual(2);
  });
});
