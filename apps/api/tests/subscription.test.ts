import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { bannerStateOf, resolveSubscription } from "../src/lib/subscription";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/mercadopago")>()),
  createPixPayment: vi.fn(async () => ({
    providerPaymentId: "mp-sub-1",
    status: "pending",
    pixQrCode: "000201pix",
    pixQrCodeBase64: "base64",
    expiresAt: new Date(Date.now() + 3600_000),
  })),
  getPayment: vi.fn(async (id: string) => {
    const { prisma: db } = await import("@meucardapio/db");
    const sub = await db.subscriptionPayment.findUnique({ where: { providerPaymentId: id } });
    return { providerPaymentId: id, status: "approved", externalReference: sub?.id ?? null, amountCents: sub?.amountCents ?? null, currency: "BRL" };
  }),
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-16T12:00:00Z");

function sub(overrides: Record<string, unknown>) {
  return {
    id: "s1",
    storeId: "st1",
    planId: null,
    status: "TRIAL",
    trialEndsAt: new Date(NOW.getTime() + 10 * DAY),
    currentPeriodEnd: null,
    canceledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    plan: null,
    ...overrides,
  } as never;
}

const plan = (features: string[]) => ({ id: "p", code: "X", name: "X", priceCents: 1000, features, active: true, position: 1, createdAt: NOW });

describe("resolveSubscription", () => {
  it("teste em andamento vale o que o BASICO tem (sem equipe) e avisa quando faltam 3 dias ou menos", () => {
    const view = resolveSubscription(sub({}), NOW, plan([]));
    expect(view.state).toBe("trial");
    expect(view.phase).toBe("TRIAL");
    expect(view.daysLeft).toBe(10);
    expect(view.features).toEqual([]);
    expect(bannerStateOf(view)).toBe("info");

    const soon = resolveSubscription(sub({ trialEndsAt: new Date(NOW.getTime() + 2 * DAY) }), NOW);
    expect(bannerStateOf(soon)).toBe("warning");
  });

  it("teste vencido bloqueia recursos", () => {
    const view = resolveSubscription(sub({ trialEndsAt: new Date(NOW.getTime() - DAY) }), NOW);
    expect(view.state).toBe("expired");
    expect(view.features).toEqual([]);
    expect(bannerStateOf(view)).toBe("expired");
  });

  it("assinatura ativa usa os recursos do plano e vira past_due ao vencer o período", () => {
    const active = resolveSubscription(sub({ status: "ACTIVE", plan: plan(["multi_user"]), currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY) }), NOW);
    expect(active.state).toBe("active");
    expect(active.features).toEqual(["multi_user"]);
    expect(bannerStateOf(active)).toBe("active");

    const lapsed = resolveSubscription(sub({ status: "ACTIVE", plan: plan(["multi_user"]), currentPeriodEnd: new Date(NOW.getTime() - DAY) }), NOW);
    expect(lapsed.state).toBe("past_due");
    expect(lapsed.features).toEqual([]);
  });

  it("cancelada mantém acesso até o fim do período pago", () => {
    const view = resolveSubscription(sub({ status: "CANCELED", plan: plan(["multi_user"]), currentPeriodEnd: new Date(NOW.getTime() + 3 * DAY) }), NOW);
    expect(view.state).toBe("canceled");
    expect(view.features).toEqual(["multi_user"]);
  });
});

describe("assinatura (integração)", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  const cleanups: Array<() => Promise<unknown>> = [];
  const onTestEnd = (fn: () => Promise<unknown>) => cleanups.push(fn);
  afterEach(async () => {
    await app.close();
    await resetDb();
    for (const fn of cleanups.splice(0)) await fn();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const staffPayload = { email: "staff@teste.com", password: "senha123" };

  function signedWebhook(dataId: string) {
    const ts = String(Date.now());
    const requestId = "req-sub";
    const v1 = createHmac("sha256", "test-webhook-secret").update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
    return app.inject({
      method: "POST",
      url: "/api/payments/webhook",
      headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
      payload: { type: "payment", data: { id: dataId } },
    });
  }

  it("loja nova começa em teste de 14 dias", async () => {
    const { cookie } = await registerStore(app);
    const plan = JSON.parse((await app.inject({ method: "GET", url: "/api/store/plan", headers: { cookie: cookie! } })).body).plan;
    expect(plan.state).toBe("info");
    expect(plan.daysLeft).toBe(14);
  });

  it("lista só o BASICO enquanto o PRO está inativo (CA-B10-07)", async () => {
    const { cookie } = await registerStore(app);
    const plans = JSON.parse((await app.inject({ method: "GET", url: "/api/plans", headers: { cookie: cookie! } })).body).plans;
    expect(plans.map((p: { code: string }) => p.code)).toEqual(["BASICO"]);
    expect(plans[0].limits).toEqual({ maxUsers: 1, maxPrinters: 1 });
  });

  it("bloqueia equipe (multi_user) com o teste vencido e libera ao assinar o plano Pro via webhook", async () => {
    // O PRO fica inativo até lançar (ADR-0003 §2.6); aqui o ligamos só para exercitar o fluxo de pagamento.
    await prisma.plan.update({ where: { code: "PRO" }, data: { active: true } });
    onTestEnd(() => prisma.plan.update({ where: { code: "PRO" }, data: { active: false } }));
    const { cookie } = await registerStore(app);
    await prisma.subscription.updateMany({ data: { trialEndsAt: new Date(Date.now() - DAY) } });

    // Teste vencido há 1 dia = Consulta: o portão da assinatura barra a escrita antes do recurso (RN-A-01).
    const locked = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: staffPayload });
    expect(locked.statusCode).toBe(403);
    expect(JSON.parse(locked.body).code).toBe("READ_ONLY");

    const checkout = await app.inject({ method: "POST", url: "/api/store/subscription/checkout", headers: { cookie: cookie! }, payload: { planCode: "PRO" } });
    expect(checkout.statusCode).toBe(201);
    expect(JSON.parse(checkout.body).payment.pixQrCode).toBe("000201pix");

    expect((await signedWebhook("mp-sub-1")).statusCode).toBe(200);
    // notificação repetida do MP não renova o período de novo
    const periodAfterFirst = (await prisma.subscription.findFirstOrThrow()).currentPeriodEnd!;
    await signedWebhook("mp-sub-1");
    expect((await prisma.subscription.findFirstOrThrow()).currentPeriodEnd!.getTime()).toBe(periodAfterFirst.getTime());

    const subscription = JSON.parse((await app.inject({ method: "GET", url: "/api/store/subscription", headers: { cookie: cookie! } })).body).subscription;
    expect(subscription.state).toBe("active");
    expect(subscription.planCode).toBe("PRO");

    const allowed = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: staffPayload });
    expect(allowed.statusCode).toBe(201);
  });

  it("recusa o checkout do PRO enquanto ele está inativo (404)", async () => {
    const { cookie } = await registerStore(app);
    const checkout = await app.inject({ method: "POST", url: "/api/store/subscription/checkout", headers: { cookie: cookie! }, payload: { planCode: "PRO" } });
    expect(checkout.statusCode).toBe(404);
  });

  it("plano Básico não inclui equipe, e cancelar mantém o acesso até o fim do período", async () => {
    const { cookie } = await registerStore(app);
    await app.inject({ method: "POST", url: "/api/store/subscription/checkout", headers: { cookie: cookie! }, payload: { planCode: "BASICO" } });
    await signedWebhook("mp-sub-1");

    const blocked = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: staffPayload });
    expect(blocked.statusCode).toBe(402);

    const cancel = await app.inject({ method: "POST", url: "/api/store/subscription/cancel", headers: { cookie: cookie! } });
    expect(cancel.statusCode).toBe(200);
    expect(JSON.parse(cancel.body).subscription.state).toBe("canceled");
  });

  it("não cancela durante o teste e rejeita plano inexistente", async () => {
    const { cookie } = await registerStore(app);
    expect((await app.inject({ method: "POST", url: "/api/store/subscription/cancel", headers: { cookie: cookie! } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/store/subscription/checkout", headers: { cookie: cookie! }, payload: { planCode: "NADA" } })).statusCode).toBe(404);
  });
});
