// `pnpm dev`: sobe a API em modo de desenvolvimento. NODE_ENV=development é EXPLÍCITO aqui porque NODE_ENV ausente conta como
// produção nas travas de segurança (fake do PIX, TRUST_PROXY_CIDR...). Funciona igual no Windows e no Linux, sem dependência extra.
import { spawn } from "node:child_process";

const child = spawn("tsx", ["watch", "src/server.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
