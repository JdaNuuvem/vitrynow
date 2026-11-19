// Ordem de travas determinística: duas transações que travam VÁRIAS linhas têm de travá-las na MESMA ordem, senão o plano da consulta (que muda sob carga)
// as cruza e o Postgres derruba uma por deadlock (P2034 ⇒ 500). Origem: `table-receive` dava [201, 500] em vez de [201, 409] numa rodada completa carregada.
// Regra da varredura: toda consulta `$queryRaw` com `FOR UPDATE` que PODE pegar mais de uma linha precisa de `ORDER BY` na mesma consulta. São de UMA linha
// (isentas): filtro pela chave primária (`"id" = ${...}` / `"sid" = ${...}`), `LIMIT 1` e `FOR UPDATE SKIP LOCKED` (a outra instância pula, não espera).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = path.resolve(__dirname, "..", "src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith(".ts") ? [full] : [];
  });

describe("FOR UPDATE de várias linhas sempre com ORDER BY", () => {
  it("nenhuma consulta que trava mais de uma linha fica sem ORDER BY", () => {
    const ofensores: string[] = [];
    // só as consultas `$queryRaw` (comentários com crases não contam): `$queryRaw<tipo>` + template
    const consulta = /\$queryRaw(?:<[^`]*?>)?`([^`]*\bFOR UPDATE\b[^`]*)`/g;
    for (const file of files(srcDir)) {
      const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      for (const m of text.matchAll(consulta)) {
        const sql = m[1];
        if (/SKIP LOCKED/.test(sql) || /LIMIT 1\b/.test(sql)) continue;
        if (/WHERE\s+"(id|sid)"\s*=\s*\$\{/.test(sql)) continue; // uma linha pela chave primária
        if (/ORDER BY/.test(sql)) continue;
        ofensores.push(`${path.relative(srcDir, file)}: ${sql.replace(/\s+/g, " ").trim().slice(0, 110)}`);
      }
    }
    expect(ofensores).toEqual([]);
  });
});
