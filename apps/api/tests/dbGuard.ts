// INF-14/INF-16: a suíte da API APAGA tabelas (resetDb). Esta é a ÚNICA regra que decide em que banco ela pode rodar,
// usada pelo vitest.config.ts (antes de qualquer teste) e pelo resetDb() (antes de qualquer DELETE). Sem Prisma e sem
// efeitos: pode ser importada pela config e testada sem banco (tests/unit/db-guard.test.ts).
//
// Regra, sem padrão e sem exceção por variável de ambiente:
//  1. a URL vem de TEST_DATABASE_URL (nunca de DATABASE_URL/.env, que podem apontar para o dev);
//  2. protocolo postgres:// ou postgresql://;
//  3. host em lista explícita (só a própria máquina);
//  4. porta na faixa dos Postgres de teste do BOARD §0 (55440–55459): nunca 5432, 5433, 55432 (dev) etc.;
//  5. nome do banco terminado em "_test" (ou _test2, _test8...).

export const TEST_DB_HOSTS = ["127.0.0.1", "localhost", "[::1]", "::1"] as const;
export const TEST_DB_PORT_MIN = 55440;
export const TEST_DB_PORT_MAX = 55459;

// Nome de banco de teste: termina em _test, opcionalmente seguido de números (_test2, _test8): um agente pode ter
// vários bancos no seu Postgres (decisão do Atlas: /_test\d*$/). Recusa _testing, _test_x, test2, etc.
export const isTestDbName = (name: string) => /_test\d*$/.test(name);

const HOW_TO = [
  "Suba o seu Postgres de teste e exporte a variável:",
  "  .\\scripts\\test-db.ps1 -Agent <nome> -Port <sua-porta, 55440-55459>",
  '  $env:TEST_DATABASE_URL = "postgresql://meucardapio:meucardapio@127.0.0.1:<sua-porta>/meucardapio_test?schema=public"',
  "Veja docs/test-db.md.",
].join("\n");

export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(`TEST_DATABASE_URL não definida: a suíte não escolhe banco sozinha (ela apaga dados).\n${HOW_TO}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TEST_DATABASE_URL inválida (não é uma URL postgresql://...).");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`TEST_DATABASE_URL com protocolo "${parsed.protocol}": só postgresql:// ou postgres://.`);
  }
  if (!(TEST_DB_HOSTS as readonly string[]).includes(parsed.hostname)) {
    throw new Error(`TEST_DATABASE_URL aponta para o host "${parsed.hostname}": só ${TEST_DB_HOSTS.join(", ")} (banco de teste é local).`);
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < TEST_DB_PORT_MIN || port > TEST_DB_PORT_MAX) {
    throw new Error(
      `TEST_DATABASE_URL usa a porta "${parsed.port || "(padrão 5432)"}": só ${TEST_DB_PORT_MIN}–${TEST_DB_PORT_MAX} (Postgres de teste por agente; a 55432 é o banco de dev).\n${HOW_TO}`,
    );
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!isTestDbName(dbName)) {
    throw new Error(`TEST_DATABASE_URL aponta para o banco "${dbName}": o nome precisa terminar em "_test" (ou _test2, _test8...; a suíte apaga dados).`);
  }
  return url;
}

// Segunda trava, dentro do resetDb: confere a URL que o Prisma de fato usa E pergunta ao próprio servidor em que banco ele
// está conectado, ANTES do primeiro DELETE. Protege até de um DATABASE_URL trocado por um import ou um .env.
export async function assertSafeToReset(opts: {
  url?: string;
  currentDatabase: () => Promise<string>;
}): Promise<void> {
  assertTestDatabaseUrl(opts.url ?? process.env.DATABASE_URL);
  const db = await opts.currentDatabase();
  if (!isTestDbName(db)) {
    throw new Error(`resetDb recusado: o servidor diz que está conectado ao banco "${db}" (não termina em "_test"). Nada foi apagado.`);
  }
}

// "host:porta/banco" sem usuário nem senha: seguro para mensagens e logs.
export function describeDb(url: string | undefined): string {
  if (!url) return "(não definida)";
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}/${decodeURIComponent(u.pathname.replace(/^\//, ""))}`;
  } catch {
    return "(URL inválida)";
  }
}
