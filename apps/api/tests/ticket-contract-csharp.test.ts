// SSOT D10 — contrato do tíquete entre a API (zod `printableOrderSchema`) e o print-client (C# `PrintableOrder.cs`).
// Teste puro (sem banco): lê os `[JsonProperty("...")]` de cada classe C# e compara com as chaves do zod. Campo novo
// no contrato sem o espelho no C# (ou o contrário) falha aqui, em vez de sumir calado do papel.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { printableOrderSchema, TICKET_SCHEMA_VERSION } from "@meucardapio/shared-types";

const cs = readFileSync(path.resolve(__dirname, "..", "..", "print-client", "Models", "PrintableOrder.cs"), "utf8");

function csharpProps(className: string): string[] {
  const start = cs.search(new RegExp(`public class ${className}\\s`));
  expect(start, `classe ${className} não encontrada no C#`).toBeGreaterThanOrEqual(0);
  const next = cs.slice(start + 1).search(/\n\s*public class /);
  const body = next < 0 ? cs.slice(start) : cs.slice(start, start + 1 + next);
  return [...body.matchAll(/\[JsonProperty\("([^"]+)"\)\]/g)].map((m) => m[1]).sort();
}

describe("SSOT D10 — tíquete: zod (API) == PrintableOrder.cs (print-client)", () => {
  const order = printableOrderSchema.shape;
  const item = order.items.element.shape;
  const additional = item.additionals.element.shape;

  it("pedido: mesmas chaves nos dois lados", () => {
    expect(csharpProps("PrintableOrder")).toEqual(Object.keys(order).sort());
  });
  it("item: mesmas chaves nos dois lados", () => {
    expect(csharpProps("PrintableOrderItem")).toEqual(Object.keys(item).sort());
  });
  it("adicional: mesmas chaves nos dois lados", () => {
    expect(csharpProps("PrintableOrderAdditional")).toEqual(Object.keys(additional).sort());
  });
  it("versão do contrato documentada é a atual", () => {
    expect(TICKET_SCHEMA_VERSION).toBe(4); // subiu a versão? confira o C# e atualize aqui
  });
});
