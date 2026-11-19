import { describe, expect, it } from "vitest";
import { DEFAULT_ACCENT, accentInk, accentOn, contrastRatio, lojaThemeStyle, normalizeAccent } from "./theme";

describe("cor da loja no cardápio (spec 12 §6, D-01)", () => {
  it("sem cor da loja, o padrão é o VERDE decidido pelo Claudio", () => {
    expect(DEFAULT_ACCENT).toBe("#1f7a54");
    expect(normalizeAccent(null)).toBe("#1f7a54");
    expect(normalizeAccent(undefined)).toBe("#1f7a54");
    expect(normalizeAccent("")).toBe("#1f7a54");
  });

  it("cor inválida cai no padrão em vez de quebrar o cardápio", () => {
    for (const bad of ["verde", "#12", "#gggggg", "rgb(1,2,3)", "#1f7a5"]) expect(normalizeAccent(bad)).toBe("#1f7a54");
  });

  it("cor válida da loja é respeitada (em minúsculas)", () => {
    expect(normalizeAccent("#B5472A")).toBe("#b5472a");
  });

  it("o texto sobre o destaque é branco quando o contraste dá 4,5:1 e escuro quando não dá", () => {
    expect(accentOn("#1f7a54")).toBe("#ffffff");
    expect(accentOn("#ffd54a")).toBe("#111111"); // amarelo claro: branco não passaria
  });

  it("usa preto quando nem branco nem #111111 atingem 4,5:1", () => {
    const accent = "#0077dd";
    expect(contrastRatio(accent, "#ffffff")).toBeLessThan(4.5);
    expect(contrastRatio(accent, "#111111")).toBeLessThan(4.5);
    expect(accentOn(accent)).toBe("#000000");
    expect(contrastRatio(accent, accentOn(accent))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["#1f7a54", "#b5472a", "#3f4fc4", "#8a2d6b", "#ffd54a", "#7dd3fc", "#f97316", "#ffffff", "#e5e5e5"])(
    "para %s: o 'accent-ink' (preço, links) sempre tem 4,5:1 sobre branco",
    (accent) => {
      expect(contrastRatio(accentInk(accent), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["#1f7a54", "#b5472a", "#3f4fc4", "#8a2d6b", "#ffd54a", "#7dd3fc", "#f97316"])("para %s: o texto sobre o destaque tem 4,5:1", (accent) => {
    expect(contrastRatio(accent, accentOn(accent))).toBeGreaterThanOrEqual(4.5);
  });

  it("cor que já passa não é escurecida à toa", () => {
    expect(accentInk("#17603f")).toBe("#17603f");
  });

  it("devolve as 3 variáveis CSS que a loja usa", () => {
    const style = lojaThemeStyle("#3f4fc4") as Record<string, string>;
    expect(style["--loja-accent"]).toBe("#3f4fc4");
    expect(style["--loja-accent-on"]).toBe("#ffffff");
    expect(contrastRatio(style["--loja-accent-ink"], "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
