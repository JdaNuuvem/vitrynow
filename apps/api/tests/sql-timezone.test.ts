import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import * as emailLib from "../src/lib/email";
import { assertDatabaseTimezone, isUtcName } from "../src/lib/dbTimezone";
import { JobRunner } from "../src/jobs/runner";
import { techCleanupJob } from "../src/jobs/techCleanup";
import { issueResetToken } from "../src/lib/passwordReset";
import { NOW_UTC, utc } from "../src/lib/sqlTime";
import { makeApp, registerStore, resetDb } from "./helpers";

// SEC-32 (ST-77, Sun Tzu; sonda do Hopper): com o Postgres FORA de UTC, um `Date` em SQL cru entrava na hora LOCAL da sessão (token de redefinição
// que nasce vencido, limpeza técnica errada, histórico que perde itens). O banco de teste é UTC e escondia o defeito: aqui o fuso do BANCO é
// trocado (ALTER DATABASE ... SET timezone) e as conexões são recriadas, e os fluxos rodam em São Paulo e em Tóquio.

const ZONES = ["America/Sao_Paulo", "Asia/Tokyo"] as const;
const silent = { info() {}, warn() {}, error() {} };
const HOUR = 60 * 60 * 1000;

async function databaseName(): Promise<string> {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  return db;
}

async function setDbTimezone(zone: string | null) {
  const db = await databaseName();
  if (zone) await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET timezone TO '${zone}'`);
  else await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET timezone`);
  await prisma.$disconnect(); // as próximas conexões do pool nascem com o fuso novo
}

async function sessionZone(): Promise<string> {
  const [{ tz }] = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
  return tz;
}

let ipSeq = 0;
const nextIp = () => `10.79.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

beforeAll(async () => {
  await setDbTimezone(null); // um aborto anterior não pode deixar o banco em outro fuso
});
afterAll(async () => {
  await setDbTimezone(null);
});

describe("helper utc() e NOW_UTC não dependem do fuso do banco", () => {
  afterEach(async () => setDbTimezone(null));

  it.each(ZONES)("%s: `utc(date)` grava e lê a MESMA hora UTC; o relógio do banco (NOW_UTC) bate com o do processo; a conversão ingênua DESLOCA (controle positivo)", async (zone) => {
    await setDbTimezone(zone);
    expect(await sessionZone()).toBe(zone); // controle positivo da premissa: a sessão de fato está no fuso pedido
    const date = new Date("2026-11-17T12:00:00.000Z");
    const [good] = await prisma.$queryRaw<{ t: string }[]>`SELECT to_char(${utc(date)}, 'YYYY-MM-DD HH24:MI:SS') AS t`;
    expect(good.t).toBe("2026-11-17 12:00:00");
    // o jeito que causava o defeito: o `Date` cru vira timestamptz e, convertido para `timestamp`, usa a hora LOCAL da sessão
    const [naive] = await prisma.$queryRaw<{ t: string }[]>`SELECT to_char((${date}::timestamptz)::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS t`;
    expect(naive.t).not.toBe("2026-11-17 12:00:00");
    const [clock] = await prisma.$queryRaw<{ t: Date }[]>`SELECT ${NOW_UTC} AS t`;
    expect(Math.abs(clock.t.getTime() - Date.now())).toBeLessThan(5_000);
  });
});

describe.each(ZONES)("fluxos com o banco em %s", (zone) => {
  beforeEach(async () => {
    await setDbTimezone(null);
    await resetDb();
    await setDbTimezone(zone);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await setDbTimezone(null);
    await resetDb();
  });

  it("redefinição de senha: o token vive ~1 h (não nasce vencido nem dura 10 h), o 2º pedido em seguida é barrado (60 s e 3/h) e o link FUNCIONA", async () => {
    expect(await sessionZone()).toBe(zone);
    const urls: string[] = [];
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async ({ resetUrl }) => {
      urls.push(resetUrl);
      return true;
    });
    const app = makeApp();
    await app.ready();
    const { credentials } = await registerStore(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });

    const before = Date.now();
    expect((await app.inject({ method: "POST", url: "/auth/forgot-password", remoteAddress: nextIp(), payload: { email: credentials.email } })).statusCode).toBe(200);
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.expiresAt.getTime()).toBeGreaterThan(before + 58 * 60_000); // sem o conserto: nasce vencido (São Paulo) ou dura ~10 h (Tóquio)
    expect(row.expiresAt.getTime()).toBeLessThan(before + 62 * 60_000);
    expect(Math.abs(row.createdAt.getTime() - before)).toBeLessThan(10_000);

    // o 2º pedido 1 s depois NÃO emite (intervalo de 60 s): sem o conserto, createdAt deslocado burlava o intervalo e a cota
    expect(await issueResetToken(credentials.email)).toBeNull();
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);

    const token = new URLSearchParams(new URL(urls[0]).hash.slice(1)).get("token")!;
    const reset = await app.inject({ method: "POST", url: "/auth/reset-password", remoteAddress: nextIp(), payload: { token, email: credentials.email, newPassword: "senha-nova-no-fuso" } });
    expect(reset.statusCode).toBe(200);
    await app.close();
  }, 120000);

  it("tech.cleanup: apaga o token expirado há 25 h e NÃO o de 23 h (corte de 24 h na hora UTC, qualquer que seja o fuso do banco)", async () => {
    const app = makeApp();
    await registerStore(app);
    await app.close();
    const user = await prisma.user.findFirstOrThrow();
    const now = new Date();
    await prisma.passwordResetToken.createMany({
      data: [
        { userId: user.id, tokenHash: `velho-${Date.now()}`, expiresAt: new Date(now.getTime() - 25 * HOUR) },
        { userId: user.id, tokenHash: `recente-${Date.now()}`, expiresAt: new Date(now.getTime() - 23 * HOUR) },
      ],
    });
    const runner = new JobRunner({ db: prisma, log: silent, now: () => now });
    runner.register(techCleanupJob);
    await runner.run("tech.cleanup");
    const left = await prisma.passwordResetToken.findMany({ where: { userId: user.id }, select: { tokenHash: true } });
    expect(left.map((r) => r.tokenHash.split("-")[0])).toEqual(["recente"]);
  }, 60000);

  it("guarda de fuso no boot: banco fora de UTC ⇒ PRODUÇÃO (e NODE_ENV ausente) RECUSA subir com o valor encontrado; desenvolvimento e teste só registram o erro e seguem", async () => {
    expect(await sessionZone()).toBe(zone);
    const logs: { obj: unknown; msg?: string }[] = [];
    const log = { error: (obj: unknown, msg?: string) => void logs.push({ obj, msg }) };
    await expect(assertDatabaseTimezone(prisma, "production", log)).rejects.toThrow(new RegExp(zone));
    await expect(assertDatabaseTimezone(prisma, undefined, log)).rejects.toThrow(/exige UTC/); // ausente conta como produção
    expect(logs.every((l) => String(l.msg).startsWith("FATAL"))).toBe(true);
    expect(logs).toHaveLength(2);
    logs.length = 0;
    await expect(assertDatabaseTimezone(prisma, "development", log)).resolves.toBe(zone);
    await expect(assertDatabaseTimezone(prisma, "test", log)).resolves.toBe(zone);
    expect(logs).toHaveLength(2); // controle positivo: avisou, e avisou com o valor encontrado
    expect(String(logs[0].msg)).toContain(zone);
    expect(String(logs[0].msg)).toMatch(/^AVISO/);
  }, 60000);
});

describe("guarda de fuso: UTC passa em silêncio", () => {
  it("banco em UTC ⇒ resolve sem log em qualquer NODE_ENV; nomes equivalentes de UTC são aceitos", async () => {
    await setDbTimezone("UTC");
    const logs: unknown[] = [];
    const log = { error: (obj: unknown) => void logs.push(obj) };
    for (const env of ["production", "development", "test", undefined]) await expect(assertDatabaseTimezone(prisma, env, log)).resolves.toMatch(/utc/i);
    expect(logs).toHaveLength(0);
    for (const name of ["UTC", "Etc/UTC", "etc/uct", "Zulu"]) expect(isUtcName(name), name).toBe(true);
    for (const name of ["America/Sao_Paulo", "Asia/Tokyo", "GMT+3", "", "UTC-3"]) expect(isUtcName(name), name).toBe(false);
    await setDbTimezone(null);
  }, 60000);
});
