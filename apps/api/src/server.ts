import "dotenv/config";
import { buildApp } from "./app";

const app = buildApp();
const port = Number(process.env.PORT ?? 3001);

app
  .listen({ port, host: "0.0.0.0" })
  .catch((error) => {
    app.log.error({ err: error }, "falha ao iniciar o servidor");
    process.exit(1);
  });

// Graceful shutdown: termina conexões (HTTP, WS, Prisma) antes de sair, em vez de cortar
// requisições em voo quando o processo é reiniciado (deploy, orquestrador, etc.).
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`recebido ${signal}, encerrando graciosamente...`);
  try {
    await app.close();
    app.log.info("encerrado.");
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "falha ao encerrar o servidor");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
