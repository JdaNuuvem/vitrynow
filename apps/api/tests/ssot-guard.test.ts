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
  // HORÁRIO/FUSO: na API só `DEFAULT_STORE_TIMEZONE` (lib/storeTime.ts) e `Store.timezone`; a do front é features/inicio/services/salesDefinition.ts. Ver D-02.
  catraca("fuso 'America/Sao_Paulo' escrito à mão", /["'`]America\/Sao_Paulo["'`]/g, {
    "apps/web/features/auditoria/AuditoriaPage.tsx": 1,
    "apps/web/features/auditoria/components/LogRow.tsx": 1,
    "apps/web/features/cupons/components/CouponRow.tsx": 1,
    "apps/web/features/cupons/couponForm.ts": 1,
    "apps/web/features/inicio/services/salesDefinition.ts": 1,
    "apps/web/features/pedidos/detail/OrderDetailView.tsx": 1,
    "apps/web/features/planos/components/PixCheckoutModal.tsx": 1,
    "apps/web/features/plataforma/PlatformUi.tsx": 1,
    "apps/web/features/privacidade/PrivacyPage.tsx": 1,
    "apps/web/features/relatorios/dateRange.ts": 1,
    "apps/api/src/lib/storeTime.ts": 1 // DEFAULT_STORE_TIMEZONE: a ÚNICA na API (PR-04)
  });
  // DINHEIRO: formatador de moeda definido à mão
  catraca("formatador de moeda reinventado (Intl currency BRL / function formatBRL)", /style:\s*["']currency["']|function\s+(formatBRL|formatMoney|formatPrice)\b/g, {
    "apps/api/src/lib/cancelMessages.ts": 1,
    "apps/web/shared/format/money.ts": 1
  });
  // STATUS: lista de status do pedido como valor de execução
  catraca("lista de status do pedido redefinida", /\[\s*["']PENDENTE["']\s*,\s*["']CONFIRMADO["']/g, {
    "apps/web/core/domain/orders.ts": 1,
    "apps/web/features/pedidos/kanban.ts": 1
  });
  // ERRO: texto de 429 solto (o único lugar é RATE_LIMITED_BODY/tooMany)
  catraca("texto de 'Muitas tentativas' escrito à mão", /["'`]Muitas tentativas/g, {
    "apps/api/src/lib/slidingLimit.ts": 1,
    "apps/api/src/modules/privacy/privacy.module.ts": 2,
    "apps/web/features/auth/hooks/useLogin.ts": 1,
    "apps/web/shared/auth/passwordPolicy.ts": 1
  });
});
