import { describe, expect, it } from "vitest";
import { hiddenOpenCount, hiddenOpenMessage } from "./hiddenOpen";

describe("hiddenOpenCount (API-70): só um inteiro >= 1 vira faixa", () => {
  it("lê o número da API", () => {
    expect(hiddenOpenCount({ openHidden: 1 })).toBe(1);
    expect(hiddenOpenCount({ openHidden: 37 })).toBe(37);
  });

  it("API antiga (campo ausente), zero e resposta vazia: nenhuma faixa", () => {
    expect(hiddenOpenCount({})).toBe(0);
    expect(hiddenOpenCount({ openHidden: 0 })).toBe(0);
    expect(hiddenOpenCount(null)).toBe(0);
    expect(hiddenOpenCount(undefined)).toBe(0);
  });

  it("valor estranho não vira número na tela: negativo, fração, texto, NaN e Infinity valem zero", () => {
    for (const bad of [-1, 1.5, "3", "abc", Number.NaN, Number.POSITIVE_INFINITY, null, true, [], {}]) {
      expect(hiddenOpenCount({ openHidden: bad }), String(bad)).toBe(0);
    }
  });

  it("a ausência de `openHidden` NÃO é inferida de `openCapped` (sem número a frase não se sustenta)", () => {
    expect(hiddenOpenCount({ openCapped: true } as { openHidden?: unknown })).toBe(0);
  });
});

describe("hiddenOpenMessage: texto aprovado pelo Ogilvy no plural; singular a validar", () => {
  it("plural, exatamente a frase aprovada", () => {
    expect(hiddenOpenMessage(2)).toBe("2 pedidos antigos em aberto não aparecem aqui. Veja em Histórico › Em aberto.");
    expect(hiddenOpenMessage(500)).toBe("500 pedidos antigos em aberto não aparecem aqui. Veja em Histórico › Em aberto.");
  });

  it("singular: nunca '1 pedidos' nem 'aparecem'", () => {
    expect(hiddenOpenMessage(1)).toBe("1 pedido antigo em aberto não aparece aqui. Veja em Histórico › Em aberto.");
  });

  it("milhares com separador do português", () => {
    expect(hiddenOpenMessage(1234)).toContain("1.234 pedidos antigos");
  });

  it("diz onde achar, mas nunca o código da API", () => {
    expect(hiddenOpenMessage(3)).not.toMatch(/openHidden|openCapped|ABERTO/);
  });
});
