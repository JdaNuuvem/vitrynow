import { describe, expect, it } from "vitest";
import { errorMessages } from "@meucardapio/shared-types/errors";
import { catalogMessage } from "./catalogMessage";

describe("catálogo de erros (D6)", () => {
  it("código aprovado devolve o texto do catálogo", () => {
    expect(catalogMessage("INVALID_TABLE")).toBe(errorMessages.INVALID_TABLE.message);
    expect(errorMessages.INVALID_TABLE.reviewed).toBe(true);
  });
  it("código mantido com o texto da API (reviewed: false) devolve undefined", () => {
    expect(errorMessages.SCHEDULE_TOO_FAR.reviewed).toBe(false);
    expect(catalogMessage("SCHEDULE_TOO_FAR")).toBeUndefined();
  });
  it("código ausente, desconhecido ou herdado de Object não conta", () => {
    expect(catalogMessage(undefined)).toBeUndefined();
    expect(catalogMessage("CODIGO_QUE_NAO_EXISTE")).toBeUndefined();
    expect(catalogMessage("toString")).toBeUndefined();
  });
});
