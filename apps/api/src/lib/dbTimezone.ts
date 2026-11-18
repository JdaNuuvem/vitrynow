// SEC-32 (ST-77): guarda de fuso do banco NO BOOT. O código grava e compara datas em UTC; o compose da infra fixa `timezone=UTC`, mas um Postgres
// externo, gerenciado ou de desenvolvimento pode não fixar. Fora de UTC, qualquer `Date` que escape do helper `utc()` (lib/sqlTime) desloca horas
// (token de redefinição que nasce vencido, janela do histórico errada). Em PRODUÇÃO a API recusa subir; em desenvolvimento e teste só avisa.
// NODE_ENV ausente conta como produção (mesma regra da SEC-22): só "development" e "test" seguem adiante com o aviso.

// SEC-33: `GMT` e os apelidos de deslocamento ZERO também são UTC (o Postgres de serviços gerenciados costuma devolver `GMT`/`Etc/GMT`); `Etc/GMT+3` e
// `GMT+3` NÃO entram (deslocamento diferente de zero).
const UTC_NAMES = /^(utc|etc\/utc|etc\/uct|uct|zulu|etc\/zulu|gmt|etc\/gmt|etc\/gmt[+-]?0|gmt0|greenwich|etc\/greenwich)$/i;

export type TimezoneDb = { $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };
export type TimezoneLog = { error: (obj: unknown, msg?: string) => void };

export function isUtcName(name: string | undefined | null): boolean {
  return !!name && UTC_NAMES.test(name.trim());
}

export function timezoneProblemMessage(found: string): string {
  return (
    `O fuso do banco (current_setting('TimeZone')) é "${found}", e a API exige UTC: datas gravadas e comparadas em SQL cru sairiam deslocadas em horas. ` +
    `Corrija no Postgres: ALTER DATABASE <banco> SET timezone TO 'UTC'; (ou "postgres -c timezone=UTC", ou timezone = 'UTC' no postgresql.conf / no parâmetro do serviço gerenciado) e reinicie a API.`
  );
}

/** Confere o fuso da sessão do banco. Devolve o fuso encontrado; em produção LANÇA se não for UTC. */
export async function assertDatabaseTimezone(db: TimezoneDb, nodeEnv: string | undefined, log: TimezoneLog): Promise<string> {
  const rows = await db.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
  const found = rows[0]?.tz ?? "(desconhecido)";
  if (isUtcName(found)) return found;
  const message = timezoneProblemMessage(found);
  const lenient = nodeEnv === "development" || nodeEnv === "test";
  if (lenient) {
    log.error({ timezone: found }, `AVISO: ${message}`);
    return found;
  }
  log.error({ timezone: found }, `FATAL: ${message}`);
  throw new Error(message);
}
