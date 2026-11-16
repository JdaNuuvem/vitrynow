import { describe, expect, it } from "vitest";
import { ageLevel, ageText, clockSkewMs, minutesInState } from "./orderAge";

const MIN = 60_000;
const T0 = Date.parse("2026-11-16T20:00:00.000Z");
const at = (minutesAgo: number) => new Date(T0 - minutesAgo * MIN).toISOString();

describe("minutesInState", () => {
  it("conta os minutos inteiros desde que entrou no estado", () => {
    expect(minutesInState(at(4), T0)).toBe(4);
    expect(minutesInState(at(4.9), T0)).toBe(4);
  });

  it("sem data ou data inválida: null (a tela não mostra tempo)", () => {
    expect(minutesInState(undefined, T0)).toBeNull();
    expect(minutesInState("não é data", T0)).toBeNull();
  });

  it("data no futuro nunca dá tempo negativo", () => {
    expect(minutesInState(new Date(T0 + 5 * MIN).toISOString(), T0)).toBe(0);
  });
});

describe("relógio do servidor (parecer R4 do Deming)", () => {
  it("navegador atrasado 10 min: sem o desvio o pedido recém-chegado parece 'do futuro'; com ele, 4 min", () => {
    const browserNow = T0 - 10 * MIN;
    const skew = clockSkewMs(new Date(T0).toISOString(), browserNow);
    expect(skew).toBe(10 * MIN);
    expect(minutesInState(at(4), browserNow, skew)).toBe(4);
    expect(minutesInState(at(4), browserNow)).toBe(0);
  });

  it("navegador adiantado 30 min não gera alerta falso de atraso", () => {
    const browserNow = T0 + 30 * MIN;
    const skew = clockSkewMs(new Date(T0).toISOString(), browserNow);
    const minutes = minutesInState(at(2), browserNow, skew);
    expect(minutes).toBe(2);
    expect(ageLevel(minutes, "PENDENTE")).toBe("ok");
  });

  it("'now' do servidor inválido: desvio 0", () => {
    expect(clockSkewMs("xx", T0)).toBe(0);
  });
});

describe("ageLevel: cor de atraso só em pedido novo", () => {
  it("ok abaixo de 5, aviso de 5 a 9, perigo a partir de 10", () => {
    expect(ageLevel(4, "PENDENTE")).toBe("ok");
    expect(ageLevel(5, "PENDENTE")).toBe("warn");
    expect(ageLevel(9, "PENDENTE")).toBe("warn");
    expect(ageLevel(10, "PENDENTE")).toBe("danger");
    expect(ageLevel(45, "PENDENTE")).toBe("danger");
  });

  it("pedido que não é novo não alerta, por mais tempo que tenha", () => {
    for (const status of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]) expect(ageLevel(90, status)).toBe("ok");
  });

  it("sem tempo conhecido: ok", () => {
    expect(ageLevel(null, "PENDENTE")).toBe("ok");
  });
});

describe("ageText: o texto sempre diz o tempo", () => {
  it.each([
    [null, ""],
    [0, "agora"],
    [4, "há 4 min"],
    [59, "há 59 min"],
    [60, "há 1 h"],
    [75, "há 1 h 15 min"],
    [180, "há 3 h"],
  ])("%s -> %s", (minutes, expected) => {
    expect(ageText(minutes)).toBe(expected);
  });
});
