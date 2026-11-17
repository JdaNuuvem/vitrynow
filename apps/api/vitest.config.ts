import { defineConfig } from "vitest/config";
import { assertTestDatabaseUrl, describeDb } from "./tests/dbGuard";

// INF-14/INF-16: a suíte APAGA tabelas (resetDb). Ela nunca escolhe um banco por conta própria: exige TEST_DATABASE_URL
// e só aceita um Postgres de teste local (host e porta em lista explícita, nome terminado em _test). A regra fica em
// tests/dbGuard.ts, testada em tests/unit/db-guard.test.ts, e o resetDb() a confere de novo antes de apagar.

const testDatabaseUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
// A suíte SOBRESCREVE DATABASE_URL pela de teste. Isso nunca é silencioso: se havia outra DATABASE_URL no ambiente
// (ex.: a do dev), avisa qual foi ignorada e qual banco a suíte vai usar (sem credenciais).
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== testDatabaseUrl) {
  console.warn(
    `[vitest.config] AVISO: DATABASE_URL (${describeDb(process.env.DATABASE_URL)}) foi IGNORADA; a suíte usa TEST_DATABASE_URL (${describeDb(testDatabaseUrl)}).`,
  );
}

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: "test-secret-nao-use-em-producao",
      MP_WEBHOOK_SECRET: "test-webhook-secret",
    },
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
