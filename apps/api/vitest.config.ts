import { defineConfig } from "vitest/config";

// INF-14: a suíte APAGA tabelas entre os testes (resetDb). Por isso ela nunca escolhe um banco por
// conta própria: exige TEST_DATABASE_URL (veja docs/test-db.md e scripts/test-db.ps1) e só aceita um
// banco cujo nome termina em "_test" e que não seja o Postgres de dev (porta 55432).
function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      [
        "TEST_DATABASE_URL não definida: a suíte não escolhe banco sozinha (ela apaga dados).",
        "Suba o seu Postgres de teste e exporte a variável:",
        "  .\\scripts\\test-db.ps1 -Agent <nome> -Port <sua-porta>",
        '  $env:TEST_DATABASE_URL = "postgresql://meucardapio:meucardapio@127.0.0.1:<sua-porta>/meucardapio_test?schema=public"',
        "Veja docs/test-db.md.",
      ].join("\n"),
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TEST_DATABASE_URL inválida (não é uma URL postgresql://...).");
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!dbName.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL aponta para o banco "${dbName}": o nome precisa terminar em "_test" (a suíte apaga dados).`);
  }
  if (parsed.port === "55432") {
    throw new Error("TEST_DATABASE_URL aponta para o Postgres de dev (porta 55432): use o seu, da faixa 55440–55459 (scripts/test-db.ps1).");
  }
  return url;
}

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
      JWT_SECRET: "test-secret-nao-use-em-producao",
      MP_WEBHOOK_SECRET: "test-webhook-secret",
    },
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
