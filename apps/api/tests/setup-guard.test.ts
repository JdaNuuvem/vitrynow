// INF-16 — o setup dos testes tem que FALHAR antes de qualquer teste (e de qualquer resetDb) quando o banco não é de teste.
// Caixa-preta: sobe o vitest num processo filho, com a configuração real de apps/api/vitest.config.ts e o ambiente que
// cada caso monta, e olha se a configuração é aceita ou recusada. Nenhum banco é aberto (o filho não roda teste nenhum).
// Requisitos (Atlas, INF-16): (1) sem padrão; (2) nome /_test\d*$/ + lista de host:porta; (3) cobrir "DATABASE_URL no banco
// de dev e TEST_DATABASE_URL ausente"; (4) nunca sobrescrever DATABASE_URL em silêncio.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const vitestBin = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const apiDir = path.resolve(__dirname, "..");

// Roda a configuração real. Se for aceita: "No test files found" + --passWithNoTests ⇒ exit 0. Se for recusada: erro de config ⇒ exit ≠ 0.
function carregar(env: Record<string, string | undefined>) {
  const base = { ...process.env };
  delete base.TEST_DATABASE_URL;
  delete base.DATABASE_URL;
  const r = spawnSync(process.execPath, [vitestBin, "run", "--passWithNoTests", "--dir", "tests/__nenhum_teste_aqui__"], {
    cwd: apiDir,
    env: { ...base, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) } as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { aceita: r.status === 0, saida: `${r.stdout}\n${r.stderr}` };
}

const DEV = "postgresql://meucardapio:meucardapio@localhost:55432/meucardapio?schema=public";
const teste = (db: string, host = "127.0.0.1", port = "55450") => `postgresql://deming:deming@${host}:${port}/${db}?schema=public`;

describe("INF-16 trava do banco de teste (config do vitest)", () => {
  it("G1 sem TEST_DATABASE_URL a suíte NÃO sobe, e a mensagem diz o que fazer", () => {
    const r = carregar({});
    expect(r.aceita, r.saida).toBe(false);
    expect(r.saida).toContain("TEST_DATABASE_URL");
  }, 90_000);

  it("G2 (caso do Turing) DATABASE_URL no banco de dev e TEST_DATABASE_URL ausente ⇒ recusa, nunca cai no banco de dev", () => {
    const r = carregar({ DATABASE_URL: DEV });
    expect(r.aceita, r.saida).toBe(false);
  }, 90_000);

  it("G3 o Postgres de dev (porta 55432) é recusado mesmo com nome terminado em _test", () => {
    const r = carregar({ TEST_DATABASE_URL: teste("meucardapio_test", "localhost", "55432") });
    expect(r.aceita, r.saida).toBe(false);
  }, 90_000);

  it("G4 nome que não termina em _test é recusado (a suíte apaga dados)", () => {
    expect(carregar({ TEST_DATABASE_URL: teste("meucardapio") }).aceita).toBe(false);
    expect(carregar({ TEST_DATABASE_URL: teste("producao") }).aceita).toBe(false);
  }, 90_000);

  it("G5 URL inválida é recusada", () => {
    expect(carregar({ TEST_DATABASE_URL: "isto-nao-e-uma-url" }).aceita).toBe(false);
  }, 90_000);

  it("G6 banco local de teste legítimo é aceito (meucardapio_test)", () => {
    const r = carregar({ TEST_DATABASE_URL: teste("meucardapio_test") });
    expect(r.aceita, r.saida).toBe(true);
  }, 90_000);

  it("G7 (INF-16 §2) nomes com número no fim são aceitos: meucardapio_test2 … _test8", () => {
    for (const nome of ["meucardapio_test2", "meucardapio_test8"]) {
      const r = carregar({ TEST_DATABASE_URL: teste(nome) });
      expect(r.aceita, `${nome}: ${r.saida}`).toBe(true);
    }
  }, 120_000);

  it("G8 (INF-16 §2) host fora da lista de permissão é recusado mesmo com nome _test (nunca um servidor remoto)", () => {
    for (const host of ["db.staging.exemplo.com", "10.0.0.5", "producao.interno"]) {
      const r = carregar({ TEST_DATABASE_URL: teste("meucardapio_test", host, "5432") });
      expect(r.aceita, `${host}: deveria recusar`).toBe(false);
    }
  }, 120_000);

  it("G9 (INF-16 §2) porta fora da faixa de testes (55440–55459) é recusada em localhost", () => {
    expect(carregar({ TEST_DATABASE_URL: teste("meucardapio_test", "127.0.0.1", "5432") }).aceita).toBe(false);
  }, 90_000);
});
