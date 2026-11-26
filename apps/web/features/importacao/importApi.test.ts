import { describe, expect, it } from "vitest";
import { IMPORT_ISSUE_CODES } from "@meucardapio/shared-types";
import { detectFormat, ISSUE_LABEL } from "./importApi";

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
});
