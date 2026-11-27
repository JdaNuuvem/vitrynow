import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// SSOT D8 (§3 do docs/PARA-O-FRONTEND.md): camadas (z-index) pela escala de tokens e larguras de @media da lista única.
const ROOT = join(__dirname, "..", "..");
const DIRS = ["app", "features", "shared", "core", "lib"];

/** larguras de tela do app: celular estreito, celular, celular/desktop (troca do layout), tela larga */
const BREAKPOINTS = { max: [340, 480, 800, 1099], min: [481, 801, 1100] } as const;
/** exceções conhecidas: encaixe das abas do topo do painel no desktop (dependem do texto das abas, não do aparelho) */
const BREAKPOINT_EXCEPTIONS: Record<string, number[]> = { "features/shell/shell.css": [950, 1080, 1120] };
/** z-index numérico só para empilhar DENTRO de um componente; camadas da página usam var(--z-*) de tokens.css */
const LOCAL_Z_MAX = 20;

function cssFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".css")) out.push(path);
    }
  };
  for (const dir of DIRS) walk(join(ROOT, dir));
  return out;
}
const rel = (path: string) => relative(ROOT, path).replace(/\\/g, "/");
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const files = cssFiles().map((path) => ({ path: rel(path), text: withoutComments(readFileSync(path, "utf8")) }));

describe("D8 — camadas e larguras de tela", () => {
  it("z-index de camada vem dos tokens --z-* (número solto só até 20, dentro de componente)", () => {
    const bad = files.flatMap(({ path, text }) =>
      [...text.matchAll(/z-index:\s*(-?\d+)/g)].filter((m) => Number(m[1]) > LOCAL_Z_MAX).map((m) => `${path}: z-index ${m[1]}`));
    expect(bad).toEqual([]);
  });

  it("todo var(--z-*) usado existe em tokens.css", () => {
    const tokens = readFileSync(join(ROOT, "shared/design/tokens.css"), "utf8");
    const defined = new Set([...tokens.matchAll(/(--z-[a-z-]+):/g)].map((m) => m[1]));
    const missing = files.flatMap(({ path, text }) => [...text.matchAll(/var\((--z-[a-z-]+)\)/g)].filter((m) => !defined.has(m[1])).map((m) => `${path}: ${m[1]}`));
    expect(missing).toEqual([]);
  });

  it("@media usa só as larguras da lista (340/480/800/1100) ou uma exceção registrada", () => {
    const bad = files.flatMap(({ path, text }) =>
      [...text.matchAll(/@media[^{]*/g)].flatMap((media) =>
        [...media[0].matchAll(/(max|min)-width:\s*(\d+)px/g)]
          .filter(([, kind, px]) => !(BREAKPOINTS[kind as "max" | "min"] as readonly number[]).includes(Number(px)) && !(BREAKPOINT_EXCEPTIONS[path] ?? []).includes(Number(px)))
          .map(([w]) => `${path}: ${w}`)));
    expect(bad).toEqual([]);
  });
});
