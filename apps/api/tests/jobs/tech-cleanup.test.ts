import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { claimWithLock } from "../../src/jobs/lock";
import { JobRunner } from "../../src/jobs/runner";
import { TECH_CLEANUP_ALLOWLIST, TECH_RETENTION_MS, techCleanupJob } from "../../src/jobs/techCleanup";
import { makeApp, registerStore, resetDb } from "../helpers";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 60 * 60 * 1000;
const silent = { info() {}, warn() {}, error() {} };

function runner() {
  const r = new JobRunner({ db: prisma, log: silent, now: () => NOW });
  r.register(techCleanupJob);
  return r;
}

async function seedUser() {
  const app = makeApp();
  await registerStore(app);
  await app.close();
  // app.close() desconecta o Prisma; ele reconecta sozinho na próxima consulta.
  return prisma.user.findFirstOrThrow();
}

describe("tech.cleanup — lista de permissão (ADR-0011 §4)", () => {
  // Se este teste falhar porque alguém acrescentou uma tabela, a revisão precisa decidir se ela
  // é mesmo técnica (token/desafio expirado) e nunca dado de negócio.
  it("limpa SOMENTE estas tabelas técnicas", () => {
    expect([...TECH_CLEANUP_ALLOWLIST].sort()).toEqual(["MfaChallenge", "PasswordResetToken"]);
  });
});

describe("tech.cleanup — comportamento (Postgres)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("apaga token e desafio vencidos há mais de 24 h; mantém os válidos e os vencidos há menos de 24 h", async () => {
    const user = await seedUser();
    await prisma.passwordResetToken.createMany({
      data: [
        { userId: user.id, tokenHash: "velho", expiresAt: ago(TECH_RETENTION_MS + HOUR) },
        { userId: user.id, tokenHash: "recente", expiresAt: ago(HOUR) },
        { userId: user.id, tokenHash: "valido", expiresAt: new Date(NOW.getTime() + HOUR) },
      ],
    });
    await prisma.mfaChallenge.createMany({
      data: [
        { userId: user.id, purpose: "refund", codeHash: "x", expiresAt: ago(TECH_RETENTION_MS + HOUR) },
        { userId: user.id, purpose: "refund", codeHash: "y", expiresAt: ago(HOUR) },
      ],
    });

    const result = await runner().run("tech.cleanup");

    expect(result).toMatchObject({ status: "ok", processed: 2 });
    expect((await prisma.passwordResetToken.findMany()).map((t) => t.tokenHash).sort()).toEqual(["recente", "valido"]);
    expect(await prisma.mfaChallenge.count()).toBe(1);
  });

  it("nunca toca dados de negócio (loja, usuário, assinatura e demais tabelas)", async () => {
    const user = await seedUser();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: "t", expiresAt: ago(10 * 24 * HOUR) } });
    const before = {
      stores: await prisma.store.count(),
      users: await prisma.user.count(),
      subscriptions: await prisma.subscription.count(),
      orders: await prisma.order.count(),
      audit: await prisma.auditLog.count(),
    };

    await runner().run("tech.cleanup");

    expect({
      stores: await prisma.store.count(),
      users: await prisma.user.count(),
      subscriptions: await prisma.subscription.count(),
      orders: await prisma.order.count(),
      audit: await prisma.auditLog.count(),
    }).toEqual(before);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("recupera atraso: itens vencidos há dias são limpos de uma vez no próximo tick; segundo tick não faz nada", async () => {
    const user = await seedUser();
    await prisma.passwordResetToken.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({ userId: user.id, tokenHash: `old-${i}`, expiresAt: ago((3 + i) * 24 * HOUR) })),
    });
    const r = runner();

    expect(await r.run("tech.cleanup")).toMatchObject({ status: "ok", processed: 5 });
    expect(await r.run("tech.cleanup")).toMatchObject({ status: "ok", processed: 0 });
  });

  it("respeita o limite por execução e deixa o excedente para o próximo tick", async () => {
    const user = await seedUser();
    await prisma.passwordResetToken.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({ userId: user.id, tokenHash: `old-${i}`, expiresAt: ago((2 + i) * 24 * HOUR) })),
    });
    const r = new JobRunner({ db: prisma, log: silent, now: () => NOW });
    r.register({ ...techCleanupJob, limit: 3 });

    expect(await r.run("tech.cleanup")).toMatchObject({ processed: 3 });
    expect(await r.run("tech.cleanup")).toMatchObject({ processed: 3 });
    expect(await r.run("tech.cleanup")).toMatchObject({ processed: 1 });
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("duas instâncias ao mesmo tempo: cada item é tratado uma vez só (soma = total)", async () => {
    const user = await seedUser();
    const total = 40;
    await prisma.passwordResetToken.createMany({
      data: Array.from({ length: total }, (_, i) => ({ userId: user.id, tokenHash: `old-${i}`, expiresAt: ago((2 + i) * HOUR + TECH_RETENTION_MS) })),
    });

    const [a, b] = await Promise.all([runner().run("tech.cleanup"), runner().run("tech.cleanup")]);

    const processed = [a, b].map((x) => (x.status === "ok" ? x.processed : -1));
    expect(processed.every((n) => n >= 0)).toBe(true);
    expect(processed[0] + processed[1]).toBe(total);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("mede o atraso: idade do item vencido além da retenção; null quando não há nada atrasado", async () => {
    const user = await seedUser();
    const r = runner();
    expect(await r.run("tech.cleanup")).toMatchObject({ lagMs: null });

    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: "t", expiresAt: ago(TECH_RETENTION_MS + 3 * HOUR) } });
    // O job limpa o item no mesmo run; o atraso medido depois é null. Para medir antes, use a função direta:
    const lag = await techCleanupJob.lagMs!({ now: NOW, db: prisma, log: silent });
    expect(lag).toBe(3 * HOUR);
  });
});

describe("claimWithLock (Postgres)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("só uma transação por vez reivindica a mesma chave; a outra volta sem esperar; liberada a chave, outra consegue", async () => {
    const key = 987654321n;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const insideFirst = new Promise<void>((resolve) => (entered = resolve));

    const first = claimWithLock(prisma, key, async () => {
      entered();
      await hold;
      return "primeira";
    });
    await insideFirst;

    const second = await claimWithLock(prisma, key, async () => "segunda");
    expect(second).toEqual({ acquired: false });

    const otherKey = await claimWithLock(prisma, key + 1n, async () => "outra chave");
    expect(otherKey).toEqual({ acquired: true, value: "outra chave" });

    release();
    expect(await first).toEqual({ acquired: true, value: "primeira" });
    expect(await claimWithLock(prisma, key, async () => "terceira")).toEqual({ acquired: true, value: "terceira" });
  });
});
