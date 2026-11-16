import { defineConfig } from "vitest/config";

// Banco dedicado (meucardapio_test) na mesma instância Postgres de dev — nunca os dados reais.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      // Duas sessões rodando testes ao mesmo tempo no mesmo banco se atropelam (resetDb);
      // cada uma pode apontar para o seu com TEST_DATABASE_URL.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://meucardapio:meucardapio@localhost:55432/meucardapio_test?schema=public",
      JWT_SECRET: "test-secret-nao-use-em-producao",
      MP_WEBHOOK_SECRET: "test-webhook-secret",
    },
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
