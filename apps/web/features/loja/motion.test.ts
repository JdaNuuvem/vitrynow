import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const lojaCss = strip(readFileSync(join(__dirname, "loja.css"), "utf8"));
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

  it("declara as duas animações da base", () => {
    expect(keyframes.map((k) => k.name)).toEqual(["loja-reveal", "loja-shimmer"]);
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

describe("a base não muda a aparência de hoje", () => {
  it("motion.css só tem seletores de classes novas (opt-in)", () => {
    // Tira o miolo dos @keyframes e dos @media, sobrando os seletores de nível raiz e os de dentro do @media.
    let rules = motionCss;
    for (const match of [...rules.matchAll(/@keyframes\s+[\w-]+\s*\{/g)].reverse()) {
      rules = rules.slice(0, match.index) + rules.slice(match.index + match[0].length + body(rules, match.index + match[0].length).length + 1);
    }
    const selectors = rules
      .split("{")
      .slice(0, -1)
      .map((part) => part.split("}").pop()!.trim())
      .filter((selector) => selector && !selector.startsWith("@media"));
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, "seletor que atinge elemento já existente").toMatch(/^\.loja \.(loja-reveal|loja__skeleton(-menu)?(::after)?|loja__visually-hidden)$/);
    }
  });
});
