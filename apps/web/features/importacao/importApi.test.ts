import { describe, expect, it } from "vitest";
import { IMPORT_ISSUE_CODES } from "@meucardapio/shared-types";
import { detectFormat, ISSUE_LABEL, rowsToCsv } from "./importApi";

describe("importação de produtos (tela)", () => {
  it("formato pela extensão; sem extensão, pelo conteúdo", () => {
    expect(detectFormat("cardapio.JSON", "categoria,nome")).toBe("json");
    expect(detectFormat("cardapio.csv", "[{}]")).toBe("csv");
    expect(detectFormat(null, '  [{"nome":"X"}]')).toBe("json");
    expect(detectFormat(null, "categoria,nome,descricao,preco")).toBe("csv");
  });
  it("todo problema que a API devolve tem texto na prévia", () => {
    for (const code of IMPORT_ISSUE_CODES) expect(ISSUE_LABEL[code], code).toBeTruthy();
  });
  it("Excel → CSV: aspas onde precisa, linhas vazias somem, número e data viram texto", () => {
    const csv = rowsToCsv([
      ["categoria", "nome", "descricao", "preco"],
      ["Pizzas", "Margherita", 'Molho, "fresco"', 42.5],
      [null, null, null, null],
      ["Bebidas", "Suco", null, 9],
    ]);
    expect(csv).toBe('categoria,nome,descricao,preco\nPizzas,Margherita,"Molho, ""fresco""",42.5\nBebidas,Suco,,9\n');
    expect(rowsToCsv([[new Date("2026-11-27T00:00:00Z"), "x"]])).toBe("2026-11-27,x\n");
  });
});