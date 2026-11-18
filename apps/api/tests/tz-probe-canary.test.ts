import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";

// INF-19 / ST-77: CANÁRIO da sonda de fuso do ci.ps1. Só roda quando o ci.ps1 aponta a suíte para uma cópia do banco de teste com
// `ALTER DATABASE ... SET timezone` e exporta TZ_PROBE_EXPECT com o fuso pedido. Fora da sonda (suíte normal) fica pulado.
// Serve de CONTROLE POSITIVO: prova que a sessão do Prisma, a mesma que a API usa, ENXERGA o fuso diferente de UTC. Sem isto, uma
// sonda que por engano rodou em UTC passaria "verde" sem ter testado nada.
const expected = process.env.TZ_PROBE_EXPECT;

describe("sonda de fuso (INF-19)", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it.skipIf(!expected)("a sessão do Prisma enxerga o fuso pedido pela sonda (não é UTC)", async () => {
    const rows = await prisma.$queryRaw<{ tz: string }[]>`select current_setting('TimeZone') as tz`;
    expect(rows[0]?.tz).toBe(expected);
    expect(expected).not.toBe("UTC");
  });

  it.skipIf(!expected)("a hora local da sessão difere da hora UTC (o fuso tem efeito de verdade)", async () => {
    const rows = await prisma.$queryRaw<{ diff: number }[]>`
      select extract(epoch from (localtimestamp(0) - (now() at time zone 'UTC')::timestamp(0)))::int as diff`;
    expect(rows[0]?.diff).not.toBe(0);
  });
});
