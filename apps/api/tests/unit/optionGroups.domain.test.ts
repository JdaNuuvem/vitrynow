import { describe, expect, it } from "vitest";
import {
  checkGroupConfig,
  checkProductGroups,
  fromPriceCents,
  resolveLine,
  unavailableGroups,
  type GroupInput,
  type GroupRow,
  type OptionRow,
} from "../../src/modules/optionGroups/optionGroups.domain";

// Núcleo puro do B8: critérios CA-B8-01..05, 07 e 10 sem banco.

const opt = (id: string, name: string, priceCents: number, active = true): OptionRow => ({ id, name, priceCents, active });
const group = (over: Partial<GroupRow> & Pick<GroupRow, "id" | "name" | "options">): GroupRow => ({
  minSelect: 0,
  maxSelect: 1,
  maxPerOption: 1,
  priceMode: "SUM",
  ...over,
});

// Pizza: Tamanho BASE (P 30, M 45, G 60) + Borda SOMA opcional (+8) + Molhos (0..3, até 2 de cada)
const tamanho = group({ id: "g-tam", name: "Tamanho", priceMode: "BASE", minSelect: 1, maxSelect: 1, options: [opt("p", "P", 3000), opt("m", "M", 4500), opt("g", "G", 6000)] });
const borda = group({ id: "g-borda", name: "Borda", options: [opt("catupiry", "Catupiry", 800), opt("cheddar", "Cheddar", 900, false)] });
const molhos = group({ id: "g-molhos", name: "Molhos", maxSelect: 3, maxPerOption: 2, options: [opt("alho", "Alho", 0), opt("bbq", "Barbecue", 200), opt("pimenta", "Pimenta", 100)] });
const pizza = { name: "Pizza", priceCents: 9999 }; // o preço do produto é ignorado quando há grupo BASE

describe("resolveLine — preço (RN-B8-03)", () => {
  it("CA-B8-01: Tamanho G (60) + Borda catupiry ×1 (+8) = 68,00 por unidade", () => {
    const r = resolveLine(pizza, [tamanho, borda], [{ optionId: "g" }, { optionId: "catupiry" }]);
    expect(r).toMatchObject({ ok: true, unitPriceCents: 6800, baseCents: 6000, extrasCents: 800 });
    if (r.ok) {
      expect(r.copies).toEqual([
        { groupName: "Tamanho", name: "G", priceCents: 6000, quantity: 1, priceMode: "BASE", optionId: "g" }, // optionId: a ficha técnica da opção dá baixa no estoque
        { groupName: "Borda", name: "Catupiry", priceCents: 800, quantity: 1, priceMode: "SUM", optionId: "catupiry" },
      ]);
    }
  });

  it("sem grupo BASE vale o preço do produto + opções SOMA × quantidade de cada", () => {
    const r = resolveLine({ name: "Burger", priceCents: 2500 }, [molhos], [{ optionId: "bbq", quantity: 2 }, { optionId: "pimenta" }]);
    expect(r).toMatchObject({ ok: true, unitPriceCents: 2500 + 2 * 200 + 100 });
  });

  it("opção opcional não escolhida não pesa; escolher nada em grupo opcional é válido", () => {
    expect(resolveLine({ name: "Burger", priceCents: 2500 }, [borda], [])).toMatchObject({ ok: true, unitPriceCents: 2500, copies: [] });
  });
});

describe("resolveLine — validações (RN-B8-01/02)", () => {
  it("CA-B8-02: grupo obrigatório sem escolha ⇒ OPTION_REQUIRED citando produto e grupo", () => {
    const r = resolveLine(pizza, [tamanho, borda], []);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ code: "OPTION_REQUIRED", groupId: "g-tam", groupName: "Tamanho" });
      expect(r.issues[0].message).toContain('"Tamanho"');
      expect(r.issues[0].message).toContain('"Pizza"');
    }
  });

  it("CA-B8-03: 4 molhos em grupo de máximo 3 ⇒ OPTION_MAX_EXCEEDED; 3 passa", () => {
    const molhos4 = group({ ...molhos, options: [...molhos.options, opt("mostarda", "Mostarda", 0)] });
    const four = resolveLine(pizza, [tamanho, molhos4], [{ optionId: "g" }, { optionId: "alho" }, { optionId: "bbq" }, { optionId: "pimenta" }, { optionId: "mostarda" }]);
    expect(four.ok).toBe(false);
    if (!four.ok) expect(four.issues.map((i) => i.code)).toEqual(["OPTION_MAX_EXCEEDED"]);
    expect(resolveLine(pizza, [tamanho, molhos4], [{ optionId: "g" }, { optionId: "alho" }, { optionId: "bbq" }, { optionId: "pimenta" }]).ok).toBe(true);
  });

  it("quantidade por opção acima do permitido ⇒ OPTION_PER_OPTION_MAX; no limite passa", () => {
    const r = resolveLine(pizza, [tamanho, molhos], [{ optionId: "g" }, { optionId: "bbq", quantity: 3 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toMatchObject([{ code: "OPTION_PER_OPTION_MAX", optionId: "bbq" }]);
    expect(resolveLine(pizza, [tamanho, molhos], [{ optionId: "g" }, { optionId: "bbq", quantity: 2 }]).ok).toBe(true);
  });

  it("CA-B8-04: opção de outro produto/loja (fora dos grupos vinculados) ⇒ OPTION_NOT_FOUND, sem pista de onde ela está", () => {
    const r = resolveLine(pizza, [tamanho], [{ optionId: "g" }, { optionId: "opt-x9" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toMatchObject([{ code: "OPTION_NOT_FOUND", optionId: "opt-x9" }]);
      expect(JSON.stringify(r.issues)).not.toContain("loja");
    }
  });

  it("CA-B8-05: opção indisponível (inativa) enviada direto ⇒ OPTION_NOT_FOUND", () => {
    const r = resolveLine(pizza, [tamanho, borda], [{ optionId: "g" }, { optionId: "cheddar" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("OPTION_NOT_FOUND");
  });

  it("opção repetida, quantidade zero/negativa/fracionária", () => {
    expect((resolveLine(pizza, [tamanho], [{ optionId: "g" }, { optionId: "g" }]) as { issues: { code: string }[] }).issues[0].code).toBe("OPTION_DUPLICATE");
    for (const quantity of [0, -1, 1.5]) {
      const r = resolveLine(pizza, [tamanho, molhos], [{ optionId: "g" }, { optionId: "alho", quantity }]);
      expect(r.ok, String(quantity)).toBe(false);
      if (!r.ok) expect(r.issues[0].code).toBe("OPTION_QUANTITY_INVALID");
    }
  });

  it("grupo BASE com duas escolhas ⇒ OPTION_MAX_EXCEEDED (sempre 1..1)", () => {
    const r = resolveLine(pizza, [tamanho], [{ optionId: "p" }, { optionId: "g" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toEqual(["OPTION_MAX_EXCEEDED"]);
  });

  it("junta TODOS os problemas de uma vez (a tela mostra tudo, não um por vez)", () => {
    const r = resolveLine(pizza, [tamanho, molhos], [{ optionId: "bbq", quantity: 3 }, { optionId: "x" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code).sort()).toEqual(["OPTION_NOT_FOUND", "OPTION_PER_OPTION_MAX", "OPTION_REQUIRED"]);
  });
});

describe("indisponível por regra (RN-B8-05, CA-B8-10)", () => {
  const semAtivas = group({ ...tamanho, options: tamanho.options.map((o) => ({ ...o, active: false })) });

  it("grupo obrigatório sem opção ativa deixa o produto indisponível e a escolha é recusada com o motivo", () => {
    expect(unavailableGroups([semAtivas, borda]).map((g) => g.id)).toEqual(["g-tam"]);
    const r = resolveLine(pizza, [semAtivas, borda], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toMatchObject([{ code: "PRODUCT_UNAVAILABLE_BY_RULE", groupId: "g-tam" }]); // sem OPTION_REQUIRED duplicado
  });

  it("grupo opcional sem opção ativa NÃO deixa o produto indisponível", () => {
    const opcionalVazio = group({ ...borda, options: [opt("c", "C", 100, false)] });
    expect(unavailableGroups([opcionalVazio])).toEqual([]);
    expect(resolveLine({ name: "X", priceCents: 1000 }, [opcionalVazio], []).ok).toBe(true);
  });

  it("mínimo maior que a capacidade (opções ativas × máximo por opção) também indisponibiliza", () => {
    const g = group({ id: "g", name: "Escolha 3", minSelect: 3, maxSelect: 3, maxPerOption: 1, options: [opt("a", "A", 0), opt("b", "B", 0)] });
    expect(unavailableGroups([g]).map((x) => x.id)).toEqual(["g"]);
    const com2 = group({ ...g, maxPerOption: 2 }); // 2 opções × 2 = 4 ≥ 3
    expect(unavailableGroups([com2])).toEqual([]);
  });
});

describe("fromPriceCents (RN-B8-04, CA-B8-07)", () => {
  it("a partir do menor preço ATIVO do grupo BASE; sem BASE é null", () => {
    expect(fromPriceCents([tamanho, borda])).toBe(3000);
    const semP = group({ ...tamanho, options: [opt("p", "P", 3000, false), opt("m", "M", 4500), opt("g", "G", 6000)] });
    expect(fromPriceCents([semP])).toBe(4500);
    expect(fromPriceCents([borda])).toBeNull();
    expect(fromPriceCents([])).toBeNull();
  });
});

describe("checkGroupConfig — configuração impossível (B8.3, B8.5)", () => {
  const base = (over: Partial<GroupInput> = {}): GroupInput => ({ name: "G", minSelect: 0, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", options: [{ name: "A", priceCents: 0 }], ...over });
  const codes = (r: ReturnType<typeof checkGroupConfig>) => ({ errors: r.errors.map((e) => e.code), warnings: r.warnings.map((w) => w.code) });

  it("máximo menor que o mínimo e máximo zero são ERROS", () => {
    expect(codes(checkGroupConfig(base({ minSelect: 3, maxSelect: 2 }))).errors).toEqual(["MAX_BELOW_MIN"]);
    expect(codes(checkGroupConfig(base({ maxSelect: 0 }))).errors).toContain("MAX_BELOW_ONE");
    expect(codes(checkGroupConfig(base({ minSelect: 2, maxSelect: null }))).errors).toEqual([]); // sem limite
  });

  it("grupo BASE é sempre 1..1: qualquer outra coisa é erro", () => {
    expect(codes(checkGroupConfig(base({ priceMode: "BASE", minSelect: 0, maxSelect: 1 }))).errors).toEqual(["BASE_MUST_BE_ONE"]);
    expect(codes(checkGroupConfig(base({ priceMode: "BASE", minSelect: 1, maxSelect: 2 }))).errors).toEqual(["BASE_MUST_BE_ONE"]);
    expect(codes(checkGroupConfig(base({ priceMode: "BASE", minSelect: 1, maxSelect: 1, maxPerOption: 1 }))).errors).toEqual([]);
  });

  it("mais de 30 opções é erro; mínimo acima das opções ativas é só AVISO; BASE com preço zero é AVISO", () => {
    expect(codes(checkGroupConfig(base({ options: Array.from({ length: 31 }, (_, i) => ({ name: `O${i}`, priceCents: 0 })) }))).errors).toEqual(["TOO_MANY_OPTIONS"]);
    expect(codes(checkGroupConfig(base({ minSelect: 2, maxSelect: 2, options: [{ name: "A", priceCents: 0 }] })))).toEqual({ errors: [], warnings: ["MIN_ABOVE_ACTIVE_OPTIONS"] });
    expect(codes(checkGroupConfig(base({ priceMode: "BASE", minSelect: 1, maxSelect: 1, options: [{ name: "Grátis", priceCents: 0 }] }))).warnings).toEqual(["BASE_PRICE_ZERO"]);
  });
});

describe("checkProductGroups (RN-B8-10, dois BASE)", () => {
  it("até 10 grupos por produto e no máximo um grupo BASE", () => {
    const sum = (i: number) => ({ id: `s${i}`, name: `S${i}`, priceMode: "SUM" as const });
    expect(checkProductGroups(Array.from({ length: 10 }, (_, i) => sum(i)))).toEqual([]);
    expect(checkProductGroups(Array.from({ length: 11 }, (_, i) => sum(i))).map((e) => e.code)).toEqual(["TOO_MANY_GROUPS"]);
    const two = checkProductGroups([{ id: "a", name: "Tamanho", priceMode: "BASE" }, { id: "b", name: "Massa", priceMode: "BASE" }]);
    expect(two.map((e) => e.code)).toEqual(["TWO_BASE_GROUPS"]);
    expect(two[0].message).toContain('"Tamanho"');
    expect(two[0].message).toContain('"Massa"');
  });
});
