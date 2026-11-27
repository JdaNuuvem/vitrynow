import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const lojaCss = strip(readFileSync(join(__dirname, "loja.css"), "utf8"));
const tokensCss = readFileSync(join(__dirname, "..", "..", "shared", "design", "tokens.css"), "utf8");
const motionCss = strip(readFileSync(join(__dirname, "motion.css"), "utf8"));

// Conteúdo entre as chaves que abrem em `start` (índice logo após a `{`).
function body(source: string, start: number): string {
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i);
  }
  throw new Error("bloco sem fechamento");
}

function firstBlock(source: string, opener: RegExp): string {
  const match = opener.exec(source);
  if (!match) throw new Error(`bloco não encontrado: ${opener}`);
  return body(source, match.index + match[0].length);
}

const declarations = (text: string) => Object.fromEntries([...text.matchAll(/(--loja-[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

const base = declarations(firstBlock(lojaCss, /^\.loja\s*\{/m));
const reduced = declarations(firstBlock(firstBlock(lojaCss, /@media \(prefers-reduced-motion: reduce\)\s*\{/), /\.loja\s*\{/));

describe("tokens de movimento da loja (spec 12 §8, WEB-28)", () => {
  it("têm os valores da spec", () => {
    expect([base["--loja-dur-1"], base["--loja-dur-2"], base["--loja-dur-3"], base["--loja-dur-4"]]).toEqual(["120ms", "200ms", "280ms", "420ms"]);
    expect(base["--loja-ease-out"]).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(base["--loja-ease-in"]).toBe("cubic-bezier(0.4, 0, 1, 1)");
    expect(base["--loja-ease-spring"]).toBe("cubic-bezier(0.34, 1.4, 0.64, 1)");
    expect(base["--loja-stagger"]).toBe("40ms");
  });

  it("durações ficam entre 80 e 420 ms (critério 8)", () => {
    const durations = Object.entries(base).filter(([name]) => /^--loja-dur-\d$/.test(name));
    expect(durations).toHaveLength(4);
    for (const [name, value] of durations) {
      const ms = Number.parseInt(value, 10);
      expect(ms, name).toBeGreaterThanOrEqual(80);
      expect(ms, name).toBeLessThanOrEqual(420);
    }
  });

  it("todo token de tempo tem versão zerada em prefers-reduced-motion (quem usa o token já respeita)", () => {
    const timeTokens = Object.keys(base).filter((name) => /^--loja-(dur-\d|stagger|shimmer)$/.test(name));
    expect(timeTokens).toHaveLength(6);
    for (const name of timeTokens) {
      expect(reduced[name], `${name} sem versão para movimento reduzido`).toMatch(/^0(\.01)?(ms)?$/);
    }
  });
});

describe("orçamento de desempenho dos @keyframes (critério 1)", () => {
  const keyframes = [...motionCss.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((match) => ({
    name: match[1],
    content: body(motionCss, match.index + match[0].length),
  }));

  it("declara as animações (base da WEB-28 + Fatia 2): nenhuma a mais sem passar pelo orçamento", () => {
    expect(keyframes.map((k) => k.name)).toEqual([
      "loja-reveal",
      "loja-shimmer",
      "loja-pop",
      "loja-pill-in",
      "loja-roll",
      "loja-scrim-in",
      "loja-scrim-out",
      "loja-sheet-in",
      "loja-sheet-out",
      "loja-modal-in",
      "loja-modal-out",
    ]);
  });

  it.each(keyframes)("$name anima só transform e opacity (compositor, sem reflow)", ({ content }) => {
    const properties = [...content.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
    expect(properties.length).toBeGreaterThan(0);
    for (const property of properties) expect(["transform", "opacity"]).toContain(property);
  });

  it("o brilho do skeleton some em movimento reduzido (M-10 estático)", () => {
    const reducedBlock = firstBlock(motionCss, /@media \(prefers-reduced-motion: reduce\)\s*\{/);
    expect(reducedBlock).toMatch(/\.loja__skeleton::after\s*\{\s*display:\s*none/);
  });

  it("a entrada em cascata para no 8º item", () => {
    expect(motionCss).toContain("min(var(--loja-index, 0), 7)");
  });
});

// Orçamento (spec 12 §8, critério 1): nada anima width, height, top, left, sombra ou filtro. Transitions só de `transform`,
// `opacity` e cor (fundo/texto dos chips, M-03). A exceção do M-12 (grid-template-rows) é da Fatia 3, com justificativa.
describe("orçamento de desempenho das transitions (critério 1)", () => {
  const ALLOWED = ["transform", "opacity", "background-color", "color", "visibility", "none"];
  const transitionProperties = (css: string) => {
    const found: string[] = [];
    for (const declaration of css.matchAll(/transition\s*:\s*([^;]+);/g)) {
      // vírgulas dentro de var()/calc() não separam transições; as de nível raiz sim
      let depth = 0;
      let current = "";
      const parts: string[] = [];
      for (const char of declaration[1]) {
        if (char === "(") depth++;
        if (char === ")") depth--;
        if (char === "," && depth === 0) {
          parts.push(current);
          current = "";
        } else current += char;
      }
      parts.push(current);
      for (const part of parts) found.push(part.trim().split(/\s+/)[0]);
    }
    return found;
  };

  it("loja.css e motion.css só fazem transition das propriedades permitidas", () => {
    const properties = [...transitionProperties(lojaCss), ...transitionProperties(motionCss)];
    expect(properties.length).toBeGreaterThan(5);
    for (const property of properties) expect(ALLOWED, `transition de "${property}" fora do orçamento`).toContain(property);
  });

  it("nenhuma transition usa 'all' (anima o que não devia)", () => {
    expect(lojaCss + motionCss).not.toMatch(/transition\s*:\s*all\b/);
  });

  it("nenhum will-change fixo: só durante a animação", () => {
    expect(lojaCss + motionCss).not.toMatch(/will-change\s*:/);
  });

  it("toda duração e curva de movimento usa os tokens (nada de milissegundos soltos)", () => {
    const loose = [...(lojaCss + motionCss).matchAll(/(?:transition|animation)\s*:[^;]*?(?<![\w-])(\d+(?:\.\d+)?m?s)\b/g)].map((match) => match[1]);
    // `0s` do atraso de visibilidade é o único literal permitido
    expect(loose.filter((value) => value !== "0s")).toEqual([]);
  });
});

describe("M-03/M-13: o chip afunda e troca de cor sem uma transition apagar a outra", () => {
  it("a regra do chip leva transform, background-color e color juntos", () => {
    const rule = /\.loja \.loja__chip-body\s*\{([^}]*)\}/.exec(motionCss)?.[1] ?? "";
    for (const property of ["transform", "background-color", "color"]) expect(rule, property).toContain(property);
  });

  it("nenhum outro seletor do chip redefine a transition (senão a última venceria e apagaria a outra)", () => {
    const rules = [...(lojaCss + motionCss).matchAll(/([^{}]*\.loja__chip-body[^{}]*)\{([^}]*)\}/g)].filter((m) => /transition/.test(m[2]));
    expect(rules).toHaveLength(1);
  });
});

describe("camadas fixas: a folha fica acima de tudo (visto no clipe da folha)", () => {
  const zIndexOf = (selector: string) => {
    // String.raw: as barras invertidas valem para o REGEX (num string comum "\\." viraria só ".")
    const escaped = selector.replace(/[.]/g, String.raw`\.`);
    const rule = new RegExp(String.raw`(?:^|\n)` + escaped + String.raw`\s*\{([^}]*)\}`).exec(lojaCss)?.[1] ?? "";
    // camadas usam os tokens --z-* de tokens.css (SSOT D8): resolve var(--z-x) para o número
    const raw = /z-index:\s*([^;]+);/.exec(rule)?.[1].trim() ?? "";
    const token = /^var\((--z-[a-z-]+)\)$/.exec(raw)?.[1];
    return Number(token ? new RegExp(String.raw`${token}:\s*(\d+)`).exec(tokensCss)?.[1] : raw);
  };

  it("a folha (carrinho/checkout) tem z-index maior que a pílula, a barra inferior, os chips e a barra superior", () => {
    const sheet = zIndexOf(".loja__sheet");
    for (const other of [".loja__cart-bar", ".loja__nav", ".loja__chipsbox", ".loja__bar"]) {
      expect(zIndexOf(other), other).toBeGreaterThan(0);
      expect(sheet, `.loja__sheet deve ficar acima de ${other}`).toBeGreaterThan(zIndexOf(other));
    }
  });
});

describe("a entrada em cascata e o JS de movimento", () => {
  it("a cascata do M-01 usa a duração e a curva dos tokens, com atraso por posição", () => {
    expect(motionCss).toMatch(/\.loja__item\[data-reveal\]\s*\{[^}]*var\(--loja-dur-3\)[^}]*var\(--loja-ease-out\)[^}]*--reveal-i/);
  });

  it("o cartão só nasce escondido pelo JS (data-reveal): sem JS o HTML do servidor aparece inteiro", () => {
    expect(lojaCss).not.toMatch(/\.loja__item\s*\{[^}]*opacity:\s*0/);
  });
});
