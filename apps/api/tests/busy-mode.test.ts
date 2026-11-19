import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { login, makeApp, registerStore, resetDb } from "./helpers";

// g1 (BUSY-1): modo ocupado "Estou lotado" (RN-OCU-01..07, CA-OCU-01..07). O fim é `busyUntil` vs relógio do servidor, sem job:
// os testes "avançam o relógio" recuando `busyUntil` no banco.

describe("modo ocupado (g1)", () => {
  let app: ReturnType<typeof makeApp>;
  let owner: string;
  let staff: string;
  let storeId: string;
  let productId: string;

  const json = (r: { body: string }) => JSON.parse(r.body);

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    const reg = await registerStore(app, { slug: "loja-ocu", code: "OC1" });
    owner = reg.cookie!;
    storeId = json(reg.response).store.id;
    const category = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: owner }, payload: { name: "C" } })).category.id;
    productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: owner }, payload: { categoryId: category, name: "Combo", priceCents: 1500 } })).product.id;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email: "staff-ocu@teste.com", password: "provisoria-12" } });
    staff = (await login(app, "staff-ocu@teste.com", "provisoria-12")).cookie!;
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const busy = (payload: unknown, cookie: string | undefined = owner) => app.inject({ method: "POST", url: "/api/store/busy", headers: cookie ? { cookie } : {}, payload });
  const unbusy = (cookie: string | undefined = owner) => app.inject({ method: "DELETE", url: "/api/store/busy", headers: cookie ? { cookie } : {} });
  const publicOrder = () => app.inject({ method: "POST", url: "/stores/loja-ocu/orders", payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1 }] } });
  const menuStore = async () => json(await app.inject({ method: "GET", url: "/stores/loja-ocu/menu" })).store;
  const rewind = (minutes: number) => prisma.store.update({ where: { id: storeId }, data: { busyUntil: new Date(Date.now() - minutes * 60_000) } });

  it("CA-OCU-01: ligar 30 min recusa pedido novo com 409 STORE_BUSY; vencido o prazo, volta sozinho (sem job)", async () => {
    const res = await busy({ minutes: 30 });
    expect(res.statusCode).toBe(200);
    expect(json(res).hours.busyUntil).toBeTruthy();
    const refused = await publicOrder();
    expect(refused.statusCode).toBe(409);
    expect(json(refused)).toMatchObject({ code: "STORE_BUSY", details: { reason: "BUSY" } });
    expect(json(refused).error).toMatch(/Voltamos a receber às \d{2}:\d{2}/);
    expect(await menuStore()).toMatchObject({ accepting: false, acceptingNow: false, reason: "BUSY" });
    await rewind(1); // o relógio passou de busyUntil
    expect((await publicOrder()).statusCode).toBe(201);
    expect(await menuStore()).toMatchObject({ accepting: true, acceptingNow: true, busyUntil: null, reason: null });
  });

  it("CA-OCU-02: pedido manual, chamar garçom e acompanhar seguem funcionando durante o modo", async () => {
    const first = await publicOrder();
    const { orderId } = json(first);
    expect((await busy({ minutes: 60 })).statusCode).toBe(200);
    const manual = await app.inject({ method: "POST", url: "/api/orders", headers: { cookie: owner }, payload: { type: "BALCAO", paymentMethod: "DEBITO", items: [{ productId, quantity: 1 }] } });
    expect(manual.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: owner } })).statusCode).toBe(200);
    expect(orderId).toBeTruthy();
  });

  it("CA-OCU-03: 5 h (ou valor fora da lista) ⇒ 400 BUSY_DURATION_INVALID", async () => {
    for (const minutes of [300, 45, 0, -5, "30"]) {
      const res = await busy({ minutes });
      expect(res.statusCode).toBe(400);
      expect(json(res).code).toBe("BUSY_DURATION_INVALID");
    }
    expect((await busy({ minutes: 30, extraMinutes: 15 })).statusCode).toBe(400);
    expect((await publicOrder()).statusCode).toBe(201);
  });

  it("CA-OCU-04: STAFF liga e desliga; sem login é 401; DELETE encerra antes da hora", async () => {
    expect((await busy({ minutes: 15 }, staff)).statusCode).toBe(200);
    expect((await publicOrder()).statusCode).toBe(409);
    expect((await unbusy(staff)).statusCode).toBe(200);
    expect((await publicOrder()).statusCode).toBe(201);
    expect((await busy({ minutes: 15 }, "")).statusCode).toBe(401);
    expect((await unbusy("")).statusCode).toBe(401);
  });

  it("CA-OCU-05: a auditoria grava ligar e encerrar antes da hora, sem dado pessoal", async () => {
    await busy({ minutes: 120, extraMinutes: 20 });
    await unbusy();
    await new Promise((r) => setTimeout(r, 300)); // o log de auditoria é fire-and-forget
    const logs = await prisma.auditLog.findMany({ where: { storeId, action: { startsWith: "store.busy" } }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["store.busy_start", "store.busy_end"]);
    expect(logs[0].metadata).toMatchObject({ minutes: 120, extraMinutes: 20 });
    expect(JSON.stringify(logs)).not.toContain("@");
  });

  it("CA-OCU-06: em Consulta a rota é recusada pela política de fase (403 READ_ONLY)", async () => {
    await prisma.subscription.updateMany({ data: { status: "TRIAL", planId: null, currentPeriodEnd: null, trialEndsAt: new Date(Date.now() - 86_400_000) } });
    expect(json(await busy({ minutes: 15 })).code).toBe("READ_ONLY");
    expect(json(await unbusy()).code).toBe("READ_ONLY");
  });

  it("CA-OCU-07: a hora mostrada respeita o fuso da loja", async () => {
    await prisma.store.update({ where: { id: storeId }, data: { timezone: "Asia/Tokyo" } });
    const res = await busy({ minutes: 60 });
    const until = new Date(json(res).hours.busyUntil);
    const tokyo = new Intl.DateTimeFormat("pt-BR", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(until);
    expect(json(await publicOrder()).error).toContain(tokyo);
  });

  it("RN-OCU-05: o prazo extra soma ao prazo mostrado só enquanto dura o modo", async () => {
    await app.inject({ method: "POST", url: "/api/store/prep-times", headers: { cookie: owner }, payload: { deliveryMinutes: 40, pickupMinutes: null } });
    await busy({ minutes: 30, extraMinutes: 20 });
    expect((await menuStore()).prepMinutes).toEqual({ delivery: 60, pickup: null });
    await rewind(1);
    expect((await menuStore()).prepMinutes).toEqual({ delivery: 40, pickup: null });
  });

  it("loja fechada pela grade ou desligada vence o modo ocupado (motivo continua claro); isolamento entre lojas", async () => {
    const other = await registerStore(app, { slug: "loja-outra", code: "OC2" });
    await busy({ minutes: 60 });
    const otherMenu = json(await app.inject({ method: "GET", url: "/stores/loja-outra/menu" })).store;
    expect(otherMenu).toMatchObject({ accepting: true, busyUntil: null });
    expect((await prisma.store.findFirstOrThrow({ where: { slug: "loja-outra" } })).busyUntil).toBeNull();
    expect(json(await app.inject({ method: "GET", url: "/api/store/hours", headers: { cookie: other.cookie! } })).hours.busyUntil).toBeNull();
    // desligar o interruptor: o motivo é SWITCHED_OFF, não BUSY
    await prisma.store.update({ where: { id: storeId }, data: { acceptingOrders: false } });
    expect(await menuStore()).toMatchObject({ accepting: false, reason: "SWITCHED_OFF" });
  });
});
