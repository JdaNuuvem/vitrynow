// D4 (papéis do painel) e D11 (dinheiro e mensagens de mínimo): a fonte é packages/shared-types
// (PANEL_ROLES / panelRoleSchema, formatCents / minOrderMessage). Estas guardas impedem voltar a valores soltos
// em apps/api/src. Catraca: o teto por arquivo só pode CAIR. Quando um literal for trocado, reduza a linha.
// Não cobre apps/web (é de outro agente). Padrão igual ao de tests/ssot-guard.test.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PANEL_ROLES, couponMinOrderMessage, formatCents, minOrderMessage, panelRoleSchema } from "@meucardapio/shared-types";

const root = path.resolve(__dirname, "..", "..", "..", "..");
const apiSrc = path.join(root, "apps", "api", "src");
const SKIP = new Set(["node_modules", "dist", ".next", "tests", "coverage", ".turbo"]);
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) ? [full] : [];
  });
const text = new Map(
  walk(apiSrc).map((f) => [path.relative(root, f).replace(/\\/g, "/"), readFileSync(f, "utf8")] as const),
);

function contar(re: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [f, t] of text) {
    const n = (t.match(re) ?? []).length;
    if (n > 0) out[f] = n;
  }
  return out;
}
function catraca(nome: string, re: RegExp, teto: Record<string, number>, dica: string) {
  it(nome, () => {
    const atual = contar(re);
    const novas = Object.entries(atual)
      .filter(([f, n]) => n > (teto[f] ?? 0))
      .map(([f, n]) => `${f}: ${n} (teto ${teto[f] ?? 0})`);
    expect(novas, dica).toEqual([]);
  });
}

describe("D4 — helpers de papel (PANEL_ROLES / panelRoleSchema)", () => {
  it("PANEL_ROLES é exatamente OWNER e STAFF, e o schema aceita só esses", () => {
    expect([...PANEL_ROLES]).toEqual(["OWNER", "STAFF"]);
    expect(panelRoleSchema.options).toEqual(["OWNER", "STAFF"]);
    expect(panelRoleSchema.safeParse("ADMIN").success).toBe(false);
  });

  // União escrita à mão ("OWNER" | "STAFF"): tem que vir de PanelRole. Teto ZERO.
  catraca(
    "união de papéis escrita à mão",
    /["']OWNER["']\s*\|\s*["']STAFF["']/g,
    {},
    "use PanelRole / panelRoleSchema (packages/shared-types), não a união de literais",
  );

  // Literais "OWNER"/"STAFF" como valor (queries, checagens). Teto ZERO.
  // Use panelRoleSchema.enum.OWNER / .STAFF.
  catraca(
    "literal de papel (\"OWNER\"/\"STAFF\") novo fora da fonte",
    /["']OWNER["']|["']STAFF["']/g,
    {},
    "literal de papel novo: use panelRoleSchema.enum.OWNER / .STAFF (ou PanelRole) em vez de \"OWNER\"/\"STAFF\"",
  );
});

describe("D11 — helpers de dinheiro (formatCents / minOrderMessage)", () => {
  it("formatCents formata em BRL com vírgula decimal e separador de milhar", () => {
    expect(formatCents(12345).replace(/\s/g, " ")).toBe("R$ 123,45");
    expect(formatCents(100000).replace(/\s/g, " ")).toBe("R$ 1.000,00");
    expect(formatCents(0).replace(/\s/g, " ")).toBe("R$ 0,00");
  });

  it("minOrderMessage usa formatCents na frase de mínimo", () => {
    expect(minOrderMessage(2000).replace(/\s/g, " ")).toBe("pedido mínimo é R$ 20,00");
  });

  it("couponMinOrderMessage mantém a frase do cupom", () => {
    expect(couponMinOrderMessage(2000)).toBe("pedido mínimo para este cupom é R$ 20,00");
  });

  // Formatação de dinheiro reinventada com "R$ ${...}" e toFixed(2). Teto ZERO.
  catraca(
    "dinheiro formatado à mão com \"R$ ${...}\"",
    /R\$ \$\{/g,
    {},
    "use formatCents (packages/shared-types), não R$ com template",
  );
  catraca(
    "dinheiro com (centavos / 100).toFixed(2)",
    /\/\s*100\)\.toFixed\(2\)/g,
    {},
    "use formatCents (packages/shared-types): toFixed(2) usa ponto e não tem R$/milhar",
  );
  catraca(
    "formatador pt-BR de moeda reinventado (toLocaleString com frações)",
    /toLocaleString\(\s*"pt-BR"\s*,\s*\{\s*minimumFractionDigits/g,
    {},
    "use formatCents (packages/shared-types)",
  );

  // Frases de mínimo escritas à mão. Teto ZERO.
  catraca(
    "frase \"pedido mínimo\" escrita à mão",
    /["'`]pedido mínimo/g,
    {},
    "use minOrderMessage / couponMinOrderMessage (packages/shared-types)",
  );
});
