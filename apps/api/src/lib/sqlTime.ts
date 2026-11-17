import { Prisma } from "@meucardapio/db";

// SEC-32 (ST-77): as colunas DateTime do Prisma são `timestamp(3)` SEM fuso, gravadas em UTC. Em SQL CRU, um `Date` do JS entra como parâmetro
// e o Postgres o converte pelo fuso da SESSÃO: com o banco em America/Sao_Paulo (ou Asia/Tokyo) o valor gravado ou comparado sai deslocado em
// horas (token que nasce vencido, janela do histórico errada, cursor que perde itens). O compose já fixa `timezone=UTC`, mas um Postgres externo
// ou de desenvolvimento pode não fixar. Regra do código: NENHUM `Date` vai direto como parâmetro em SQL cru; passa por `utc(...)`, e "agora" no
// banco é `NOW_UTC`. O teste `tests/sql-timezone.test.ts` roda os fluxos com o banco em São Paulo e em Tóquio.

/** Relógio do BANCO em UTC, como `timestamp` sem fuso (mesma convenção das colunas). */
export const NOW_UTC = Prisma.raw("(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')");

/** Um `Date` do JS como `timestamp` UTC, independente do fuso da sessão: use no lugar de `${date}` em SQL cru. */
export function utc(date: Date): Prisma.Sql {
  return Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`;
}
