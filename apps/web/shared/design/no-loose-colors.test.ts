import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// SSOT D8 (§1.4 do docs/PARA-O-FRONTEND.md): cor do painel/cardápio vem de TOKEN, não de #hex solto nas regras.
// Catraca: cada arquivo tem um teto de #hex; só os arquivos de PALETA têm teto > 0. Baixar um teto é bem-vindo; subir exige motivo.
const ROOT = join(__dirname, "..", "..");
const DIRS = ["app", "features", "shared", "core", "lib"];
const HEX_CEILING: Record<string, number> = {
  "shared/design/tokens.css": 48, // paletas clara e escura
  "features/loja/loja.css": 29, // paleta --loja-* (topo do arquivo)
  "features/loja/theme.ts": 10, // cor da loja e contraste (cálculo)
  "features/conta/aparencia/AppearanceEditor.tsx": 7, // opções de cor que o lojista escolhe (dado)
  "features/conta/campanha/CampaignPages.tsx": 1, // cor de demonstração
  "features/salao/scene/palette.ts": 8, // materiais da maquete 3D (o WebGL precisa de cor concreta; status vem dos tokens)
  "features/loja/cardapio.css": 1, // color-mix(..., #24251e) do banner
};

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
    }
  };
  for (const dir of DIRS) walk(join(ROOT, dir));
  return out;
}
const rel = (path: string) => relative(ROOT, path).replace(/\\/g, "/");
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const files = sourceFiles().map((path) => ({ path: rel(path), text: readFileSync(path, "utf8") }));

describe("D8 — cores pelo token", () => {
  it("nenhum arquivo passa do teto de #hex (só paletas têm hex)", () => {
    const over = files
      .map(({ path, text }) => ({ path, count: (withoutComments(text).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length }))
      .filter(({ path, count }) => count > (HEX_CEILING[path] ?? 0))
      .map(({ path, count }) => `${path}: ${count} (teto ${HEX_CEILING[path] ?? 0})`);
    expect(over).toEqual([]);
  });

  it("todo var(--x) aponta para um token que existe (sem reserva que esconde token inexistente)", () => {
    const defined = new Set<string>();
    for (const { text } of files) {
      for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]); // CSS e objetos de estilo
      for (const m of text.matchAll(/["'](--[a-zA-Z0-9-]+)["']/g)) defined.add(m[1]); // next/font `variable` e setProperty
    }
    const missing = new Set<string>();
    for (const { path, text } of files) {
      // Sem definição E (sem reserva OU reserva #hex) = o bug do §1.1: a cor cai sempre na reserva e ignora o tema.
      // Reserva não-cor (ex.: `var(--loja-index, 0)`, posta pela tela) é parâmetro opcional, não token.
      for (const m of withoutComments(text).matchAll(/var\((--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]*))?\)/g)) {
        const fallback = m[2]?.trim();
        if (!defined.has(m[1]) && (!fallback || /^#[0-9a-fA-F]{3,8}$/.test(fallback))) missing.add(`${m[1]} (${path})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("todo token de cor do tema claro tem versão no tema escuro", () => {
    const tokens = readFileSync(join(ROOT, "shared/design/tokens.css"), "utf8");
    const block = (selector: RegExp) => {
      const start = tokens.search(selector);
      return start < 0 ? "" : tokens.slice(start, tokens.indexOf("}", start));
    };
    const colorTokens = (css: string) => new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[1]));
    const light = colorTokens(block(/:root\s*\{/));
    const dark = new Set([...block(/:root\[data-theme="dark"\]\s*\{/).matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
    expect([...light].filter((t) => !dark.has(t))).toEqual([]);
  });
});
