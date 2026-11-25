// Gera docs/textos-de-erro-para-revisar.md a partir do catálogo único (packages/shared-types/src/errorMessages.ts), para a revisão
// de conteúdo (sócio/Ogilvy). Lê o arquivo como texto: uma entrada por linha `CODIGO: e("texto", "superficie", ...)` ou `ok(...)`.
//   node scripts/textos-de-erro.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "packages/shared-types/src/errorMessages.ts"), "utf8");
const rows = [];
let secao = "Geral";
for (const line of src.split(/\r?\n/)) {
  const c = line.match(/^\s+\/\/\s*(.+)$/);
  if (c && !/^\s+\/\/.*(e\(|ok\()/.test(line)) { secao = c[1].trim(); continue; }
  const m = line.match(/^\s+([A-Z][A-Z0-9_]+):\s*(e|ok)\(\s*"((?:[^"\\]|\\.)*)"((?:\s*,\s*"[a-z]+")*)\s*\)/);
  if (m) rows.push({ code: m[1], ok: m[2] === "ok", msg: m[3].replace(/\\"/g, '"'), surf: [...m[4].matchAll(/"([a-z]+)"/g)].map((x) => x[1]), secao });
}
const pend = rows.filter((r) => !r.ok);
const esc = (s) => s.replace(/\|/g, "\\|");
const out = [
  "# Textos de erro para revisar (SSOT D6)",
  "",
  `Gerado por \`node scripts/textos-de-erro.mjs\` a partir de \`packages/shared-types/src/errorMessages.ts\`. **${pend.length} de ${rows.length} textos ainda em rascunho.**`,
  "",
  "**Como revisar:** para cada linha, aprove o texto ou escreva o novo na coluna *Texto final*. Depois o dev troca no catálogo `e(\"...\")` por",
  "`ok(\"texto final\")`. A partir daí, painel e cardápio passam a mostrar o texto aprovado (em vez do texto técnico que a API manda hoje).",
  "",
  "Regras de escrita sugeridas: falar com a pessoa (\"Informe...\", \"Escolha...\"), dizer o que fazer em seguida, sem jargão (nada de \"inválido\" sozinho",
  "quando dá para dizer o que está errado), no máximo uma frase curta. **loja** = cliente final no cardápio; **painel** = dono e equipe.",
  "",
  "| Código | Onde aparece | Texto atual (rascunho) | Texto final |",
  "|---|---|---|---|",
  ...pend.map((r) => `| \`${r.code}\` | ${r.surf.join(", ")} | ${esc(r.msg)} | |`),
  "",
];
writeFileSync(path.join(root, "docs/textos-de-erro-para-revisar.md"), out.join("\n"), "utf8");
console.log(`${rows.length} entradas, ${pend.length} para revisar -> docs/textos-de-erro-para-revisar.md`);
if (rows.length < 50) { console.error("poucas entradas lidas: o formato do catálogo mudou?"); process.exit(1); }
