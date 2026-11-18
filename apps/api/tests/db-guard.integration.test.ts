import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, prisma } from "@meucardapio/db";
import { assertSafeToReset } from "./dbGuard";

// INF-16, prova com banco REAL da segunda trava do resetDb: um servidor que responde outro current_database().
// A URL do teste PASSA na regra (porta e nome certos), mas a conexão que consultamos está ligada ao banco "postgres" do mesmo
// servidor. A trava tem de recusar ANTES do primeiro DELETE; uma linha sentinela no banco de teste prova que nada foi apagado.
// Este arquivo NÃO chama resetDb: só apaga a própria linha sentinela.
const SENTINELA = "inf16_sentinela";
const testUrl = process.env.TEST_DATABASE_URL as string;
let outroBanco: PrismaClient;

const currentDb = (client: { $queryRaw: PrismaClient["$queryRaw"] }) => async () =>
  ((await client.$queryRaw`select current_database() as db`) as { db: string }[])[0].db;

beforeAll(async () => {
  const u = new URL(testUrl);
  u.pathname = "/postgres"; // mesmo servidor, outro banco (existe em todo Postgres)
  outroBanco = new PrismaClient({ datasourceUrl: u.toString() });
  await prisma.store.deleteMany({ where: { id: SENTINELA } });
  await prisma.store.create({ data: { id: SENTINELA, name: "Sentinela INF-16", slug: SENTINELA, code: "INF16" } });
});

afterAll(async () => {
  await prisma.store.deleteMany({ where: { id: SENTINELA } });
  await outroBanco.$disconnect();
  await prisma.$disconnect();
});

describe("INF-16 · segunda trava do resetDb com servidor real", () => {
  it("o servidor de teste responde um banco _test e a trava deixa passar", async () => {
    await expect(assertSafeToReset({ currentDatabase: currentDb(prisma) })).resolves.toBeUndefined();
  });

  it("o MESMO servidor, ligado a outro banco (postgres), é recusado antes do 1º DELETE e a sentinela sobrevive", async () => {
    expect(await currentDb(outroBanco)()).toBe("postgres"); // premissa: o servidor realmente responde outro nome
    await expect(assertSafeToReset({ currentDatabase: currentDb(outroBanco) })).rejects.toThrow(/o servidor diz que está conectado ao banco "postgres".*Nada foi apagado/);
    expect(await prisma.store.count({ where: { id: SENTINELA } })).toBe(1);
  });
});
