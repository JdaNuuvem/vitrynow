// Testes-guarda de FONTE ÚNICA (programa "desenhar tudo e organizar"): catraca. Cada regra conta quantas CÓPIAS de um dado existem hoje e falha se surgir uma
// nova (a contagem por arquivo não pode subir). Quando uma duplicação for corrigida, REDUZA a linha da lista abaixo (a catraca só gira para um lado).
// Vale para apps/api/src e apps/web (sem testes). Ver programa-desenho/AUDITORIA-DUPLICACAO.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..", "..");
const SKIP = new Set(["node_modules", "dist", ".next", "tests", "coverage", ".turbo"]);
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [full] : [];
  });
const files = [...walk(path.join(root, "apps", "api", "src")), ...walk(path.join(root, "apps", "web"))];
const text = new Map(files.map((f) => [path.relative(root, f).replace(/\\/g, "/"), readFileSync(f, "utf8")]));

function contar(re: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [f, t] of text) {
    const n = (t.match(re) ?? []).length;
    if (n > 0) out[f] = n;
  }
  return out;
}
// falha se QUALQUER arquivo tem mais cópias do que o teto, ou se aparece arquivo novo com cópia
function catraca(nome: string, re: RegExp, teto: Record<string, number>) {
  it(nome, () => {
    const atual = contar(re);
    const novas = Object.entries(atual).filter(([f, n]) => n > (teto[f] ?? 0)).map(([f, n]) => `${f}: ${n} (teto ${teto[f] ?? 0})`);
    expect(novas, "nova cópia de um dado que já tem fonte única — use a fonte, ou reduza a duplicação (AUDITORIA-DUPLICACAO.md)").toEqual([]);
  });
}

describe("catraca de fonte única (nenhuma cópia nova)", () => {
  // HORÁRIO/FUSO (SSOT D1, fechado): na API só `DEFAULT_STORE_TIMEZONE` (lib/storeTime.ts); no web só shared/format/storeTime.ts
  // (formatInStoreTimezone + useStoreTimezone). Todo o resto recebe `Store.timezone`.
  catraca("fuso 'America/Sao_Paulo' escrito à mão", /["'`]America\/Sao_Paulo["'`]/g, {
    "apps/web/shared/format/storeTime.ts": 1, // DEFAULT_STORE_TIMEZONE: a ÚNICA no web (PR-05)
    "apps/api/src/lib/storeTime.ts": 1 // DEFAULT_STORE_TIMEZONE: a ÚNICA na API (PR-04)
  });
  // DINHEIRO: formatador de moeda definido à mão
  catraca("formatador de moeda reinventado (Intl currency BRL / function formatBRL)", /style:\s*["']currency["']|function\s+(formatBRL|formatMoney|formatPrice)\b/g, {
    "apps/api/src/lib/cancelMessages.ts": 1,
    "apps/web/shared/format/money.ts": 1
  });
  // COTAÇÃO (SSOT D5, fechado): frete grátis e total do pedido só em shared-types/quote (servidor e prévia do checkout).
  catraca("regra de frete grátis ou soma do total reescrita", /threshold\s*\)?\s*\?\s*0\b|>=\s*threshold\s*\?|subtotalCents\s*\+\s*\w*[dD]eliveryFee\w*\s*\+\s*\w*[tT]ip/g, {});
  // STATUS: lista de status do pedido como valor de execução
  catraca("lista de status do pedido redefinida", /\[\s*["']PENDENTE["']\s*,\s*["']CONFIRMADO["']/g, {
    "apps/api/src/modules/orders/orders.history.ts": 1,
    "apps/api/src/routes/tables.ts": 1
    // web: a lista vem de @meucardapio/shared-types/constants (SSOT D3); kanban.ts e orders.ts não a redefinem mais
  });
  // ERRO: texto de 429 solto (o único lugar é RATE_LIMITED_BODY/tooMany)
  catraca("texto de 'Muitas tentativas' escrito à mão", /["'`]Muitas tentativas/g, {
    "apps/api/src/lib/slidingLimit.ts": 1,
    "apps/api/src/modules/privacy/privacy.module.ts": 2,
    "apps/web/features/auth/hooks/useLogin.ts": 1,
    "apps/web/shared/auth/passwordPolicy.ts": 1
  });
});
