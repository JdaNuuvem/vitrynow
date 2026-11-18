import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Regra de voz do Ogilvy (17/11): nenhum texto visível usa "pro", "pra", "tá" ou "né" (nem variantes de chat). Esta varredura trava
// isso no código. Só vale para minúsculas e iniciais maiúsculas de frase ("Pra", "Tá"): "PRO"/"Pro" do nome de um plano passam.
const FORBIDDEN = ["pro", "pra", "pras", "pros", "tá", "né", "tô", "vc", "vcs", "pq", "blz", "tbm"];
const withCapital = FORBIDDEN.filter((word) => word !== "pro" && word !== "pros").map((word) => word[0].toUpperCase() + word.slice(1));
// lookarounds Unicode: "\b" do JS não enxerga letra acentuada (tá, né). String.raw: as barras invertidas valem para o REGEX (num
// template comum "\p" vira só "p" e o detector passaria a achar "pro" dentro de "produto").
const WORD_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const WORD_AFTER = String.raw`(?![\p{L}\p{N}_])`;
const PATTERN = new RegExp(`${WORD_BEFORE}(?:${[...FORBIDDEN, ...withCapital].join("|")})${WORD_AFTER}`, "u");

/** Tira comentários (de bloco, de JSX e de linha) para varrer só o que pode ser texto de tela ou código. `//` de URL (https://) fica. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, "$1");
}

export function forbiddenWordsIn(source: string): string[] {
  return stripComments(source)
    .split("\n")
    .flatMap((line, index) => {
      const hit = PATTERN.exec(line);
      return hit ? [`linha ${index + 1}: "${hit[0]}" em ${line.trim().slice(0, 90)}`] : [];
    });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

describe("regra de voz: nenhum texto de tela usa 'pro', 'pra', 'tá', 'né' (Ogilvy)", () => {
  it("o código do web não tem nenhuma dessas palavras fora de comentário", () => {
    const root = join(__dirname, "..", "..");
    const found: string[] = [];
    for (const dir of ["app", "features", "shared", "core", "lib"]) {
      for (const file of sourceFiles(join(root, dir))) {
        for (const hit of forbiddenWordsIn(readFileSync(file, "utf8"))) found.push(`${relative(root, file)} ${hit}`);
      }
    }
    expect(found, `texto informal em tela:\n${found.join("\n")}`).toEqual([]);
  });

  describe("o detector funciona (senão a varredura acima não prova nada)", () => {
    it("acha as palavras proibidas em texto de tela, com ou sem acento e inicial maiúscula", () => {
      expect(forbiddenWordsIn("<p>Voltar pro login</p>")).toHaveLength(1);
      expect(forbiddenWordsIn('const t = "útil pra investigar";')).toHaveLength(1);
      expect(forbiddenWordsIn("<p>Tá tudo certo, né?</p>")).toHaveLength(1);
      expect(forbiddenWordsIn("<p>Pra você</p>")).toHaveLength(1);
      expect(forbiddenWordsIn("<p>vc pode</p>")).toHaveLength(1);
    });

    it("não acusa palavras que só CONTÊM essas letras nem o nome do plano", () => {
      expect(forbiddenWordsIn("<p>próximo passo, para você, produto, projeto, pratos, nenéns</p>")).toEqual([]);
      expect(forbiddenWordsIn("<p>Plano PRO e plano Pro</p>")).toEqual([]);
    });

    it("ignora comentário de linha, de bloco e de JSX, mas mantém URL com //", () => {
      expect(forbiddenWordsIn("// serve pra algo\nconst a = 1;")).toEqual([]);
      expect(forbiddenWordsIn("/* tá aqui pra isso */ const a = 1;")).toEqual([]);
      expect(forbiddenWordsIn("<div>{/* pra quê */}<p>ok</p></div>")).toEqual([]);
      expect(forbiddenWordsIn('const url = "https://exemplo.com"; const t = "pra você";')).toHaveLength(1);
    });
  });
});
