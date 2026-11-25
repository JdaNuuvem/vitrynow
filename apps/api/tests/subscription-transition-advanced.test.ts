// Job subscription.transition (fase observada + auditoria + expiração de cobrança) e relatórios avançados (API-45, PRO).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { orderStore, productStore } from "./helpers";
import { registeredJobs } from "../src/jobs/registry";
import { subscriptionTransitionJob } from "../src/jobs/subscriptionTransition";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, registerStore, resetDb } from "./helpers";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const DAY = 24 * 60 * 60 * 1000;

describe("subscription.transition", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  const run = (now: Date) => subscriptionTransitionJob.runOnce({ now, db: prisma, log, limit: 500 });
  const sub = (storeId: string) => prisma.subscription.findUniqueOrThrow({ where: { storeId } });
  const changes = () => prisma.auditLog.findMany({ where: { action: "subscription.phase_change" }, orderBy: { createdAt: "asc" } });

  it("registrado; 1ª passada grava a linha de base sem auditar; TRIAL → READ_ONLY → SUSPENDED audita cada mudança uma vez", async () => {
    expect(registeredJobs.map((j) => j.name)).toContain("subscription.transition");
    const { response } = await registerStore(app, { plan: "BASICO" });
    const storeId = JSON.parse(response.body).store.id as string;
    const trialEnd = (await sub(storeId)).trialEndsAt;

    await run(new Date(trialEnd.getTime() - DAY));
    expect((await sub(storeId)).phase).toBe("TRIAL");
    expect(await changes()).toEqual([]);

    await run(new Date(trialEnd.getTime() + 1000));
    await run(new Date(trialEnd.getTime() + 2000)); // idempotente
    await run(new Date(trialEnd.getTime() + 8 * DAY));
    expect((await changes()).map((c) => c.metadata)).toEqual([
      { from: "TRIAL", to: "READ_ONLY", status: "TRIAL" },
      { from: "READ_ONLY", to: "SUSPENDED", status: "TRIAL" },
    ]);
    expect((await sub(storeId)).phase).toBe("SUSPENDED");
  });

  it("reativação: SUSPENDED → ACTIVE quando o período pago volta a valer", async () => {
    const { response } = await registerStore(app); // nasce PRO ativo
    const storeId = JSON.parse(response.body).store.id as string;
    const s = await sub(storeId);
    await prisma.subscription.update({ where: { id: s.id }, data: { phase: "SUSPENDED" } });
    await run(new Date());
    expect((await changes()).map((c) => c.metadata)).toEqual([{ from: "SUSPENDED", to: "ACTIVE", status: "ACTIVE" }]);
  });

  it("expira a cobrança PIX de assinatura esquecida (prazo vencido); a recente fica", async () => {
    const { response } = await registerStore(app);
    const storeId = JSON.parse(response.body).store.id as string;
    const s = await sub(storeId);
    const old = await prisma.subscriptionPayment.create({ data: { subscriptionId: s.id, planCode: "PRO", amountCents: 100, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    const fresh = await prisma.subscriptionPayment.create({ data: { subscriptionId: s.id, planCode: "PRO", amountCents: 100, expiresAt: new Date(Date.now() + 60_000) } });
    await run(new Date());
    expect((await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("EXPIRADO");
    expect((await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("PENDENTE");
  });
});

describe("API-45 — relatórios avançados", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    resetLimits();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function seedOrder(storeId: string, createdAt: string, totalCents: number, phone: string | null) {
    return prisma.order.create({
      data: { storeId, code: Math.random().toString(36).slice(2, 8), type: "BALCAO", status: "CONCLUIDO", subtotalCents: totalCents, totalCents, customerPhone: phone, createdAt: new Date(createdAt) },
    });
  }

  it("por hora/dia da semana (fuso da loja), comparação com o período anterior, funcionário que aceitou e clientes novos x recorrentes", async () => {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    await prisma.store.update({ where: { id: storeId }, data: { timezone: "America/Sao_Paulo" } });
    const owner = await prisma.user.findFirstOrThrow({ where: { storeId } });
    // período anterior (03 a 09/11): 1 venda de 10,00 do cliente A
    await seedOrder(storeId, "2026-11-05T15:00:00Z", 1000, "11900000001");
    // período atual (10 a 16/11): 12:00 local (15Z) na terça 10/11 e 20:00 local (23Z) no sábado 14/11
    const a = await seedOrder(storeId, "2026-11-10T15:00:00Z", 3000, "11900000001"); // A volta: recorrente
    await seedOrder(storeId, "2026-11-14T23:00:00Z", 2000, "11900000002"); // B: novo
    await seedOrder(storeId, "2026-11-14T23:30:00Z", 1000, "11900000002"); // B compra 2x no período
    await prisma.orderStatusHistory.create({ data: { orderId: a.id, storeId: await orderStore(a.id), status: "CONFIRMADO", userId: owner.id, source: "PANEL" } });

    const r = await app.inject({ method: "GET", url: "/api/reports/advanced?from=2026-11-10&to=2026-11-16", headers: { cookie: cookie! } });
    expect(r.statusCode, r.body).toBe(200);
    const body = json(r);
    expect(body.byHour).toHaveLength(24);
    expect(body.byHour[12]).toEqual({ hour: 12, orderCount: 1, revenueCents: 3000 });
    expect(body.byHour[20]).toEqual({ hour: 20, orderCount: 2, revenueCents: 3000 });
    expect(body.byWeekday.find((d: { weekday: number }) => d.weekday === 2)).toEqual({ weekday: 2, orderCount: 1, revenueCents: 3000 });
    expect(body.byWeekday.find((d: { weekday: number }) => d.weekday === 6)).toEqual({ weekday: 6, orderCount: 2, revenueCents: 3000 });
    expect(body.comparison.revenueCents).toEqual({ current: 6000, previous: 1000, changePercent: 500 });
    expect(body.comparison.previous).toEqual({ fromDate: "2026-11-03", toDate: "2026-11-09" });
    expect(body.byStaff).toEqual([{ userId: owner.id, email: owner.email, acceptedOrders: 1, acceptedRevenueCents: 3000, tablesReceived: 0, tablesRevenueCents: 0 }]);
    expect(body.customers).toMatchObject({ identified: 2, new: 1, returning: 1, returningPercent: 50, boughtTwiceOrMoreInPeriod: 1, newRevenueCents: 3000, returningRevenueCents: 3000 });
    expect(r.body).not.toContain("11900000001"); // telefone nunca sai
  });

  it("fora do PRO: 402 FEATURE_LOCKED; STAFF: 403", async () => {
    const basico = await registerStore(app, { plan: "BASICO" });
    const r = await app.inject({ method: "GET", url: "/api/reports/advanced", headers: { cookie: basico.cookie! } });
    expect([r.statusCode, json(r).code]).toEqual([402, "FEATURE_LOCKED"]);
    const pro = await registerStore(app);
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: pro.cookie! }, payload: { email: "rel-staff@t.com", password: "provisoria-12" } });
    const staff = ((await app.inject({ method: "POST", url: "/auth/login", payload: { email: "rel-staff@t.com", password: "provisoria-12" } })).headers["set-cookie"] as string).split(";")[0];
    expect((await app.inject({ method: "GET", url: "/api/reports/advanced", headers: { cookie: staff } })).statusCode).toBe(403);
  });
});
