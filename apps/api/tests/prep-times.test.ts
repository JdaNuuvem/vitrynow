import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

// API-57 (RN-PZ-01): tempo médio de preparo por loja, só exposto quando configurado.

describe("prazo de preparo por loja (API-57)", () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    cookie = (await registerStore(app, { slug: "loja-prep", code: "PR1" })).cookie!;
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  const save = (payload: unknown, as = cookie) => app.inject({ method: "POST", url: "/api/store/prep-times", headers: { cookie: as }, payload: payload as never });
  const menuStore = async () => json(await app.inject({ method: "GET", url: "/stores/loja-prep/menu" })).store;

  it("padrão: sem previsão — o painel mostra nulos e o cardápio NÃO traz prepMinutes (nada inventado)", async () => {
    const hours = json(await app.inject({ method: "GET", url: "/api/store/hours", headers: { cookie } })).hours;
    expect(hours.prepMinutes).toEqual({ delivery: null, pickup: null });
    expect(await menuStore()).not.toHaveProperty("prepMinutes");
  });

  it("configura entrega e retirada separadas; o cardápio passa a trazer os dois números", async () => {
    const response = await save({ deliveryMinutes: 45, pickupMinutes: 20 });
    expect(response.statusCode).toBe(200);
    expect(json(response).hours.prepMinutes).toEqual({ delivery: 45, pickup: 20 });
    expect((await menuStore()).prepMinutes).toEqual({ delivery: 45, pickup: 20 });
  });

  it("só uma modalidade configurada: a outra vai como null; limpar tudo remove o campo do cardápio", async () => {
    await save({ deliveryMinutes: 30, pickupMinutes: null });
    expect((await menuStore()).prepMinutes).toEqual({ delivery: 30, pickup: null });
    await save({ deliveryMinutes: null, pickupMinutes: null });
    expect(await menuStore()).not.toHaveProperty("prepMinutes");
  });

  it("faixa 5 a 240 (limites incluídos); fora disso, fracionário ou texto é 400 e nada muda", async () => {
    for (const ok of [5, 240]) expect((await save({ deliveryMinutes: ok, pickupMinutes: ok })).statusCode, String(ok)).toBe(200);
    for (const bad of [4, 241, 0, -10, 20.5, "30"]) {
      expect((await save({ deliveryMinutes: bad, pickupMinutes: null })).statusCode, String(bad)).toBe(400);
    }
    expect((await save({ deliveryMinutes: 30 })).statusCode).toBe(400); // as duas chaves são obrigatórias (null limpa)
    const store = await prisma.store.findFirstOrThrow();
    expect({ d: store.prepMinutesDelivery, p: store.prepMinutesPickup }).toEqual({ d: 240, p: 240 });
  });

  it("RN-PZ-07 / auditoria: grava antes e depois", async () => {
    await save({ deliveryMinutes: 30, pickupMinutes: null });
    await save({ deliveryMinutes: 40, pickupMinutes: 15 });
    let rows: Array<{ metadata: unknown }> = [];
    for (let i = 0; i < 50 && rows.length < 2; i++) {
      rows = await prisma.auditLog.findMany({ where: { action: "store.prep_times_update" }, orderBy: { createdAt: "asc" } });
      if (rows.length < 2) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(rows).toHaveLength(2);
    expect(rows[1].metadata).toMatchObject({ before: { delivery: 30, pickup: null }, after: { delivery: 40, pickup: 15 } });
  });

  it("só o OWNER configura; sem login é 401; na Consulta é 403 READ_ONLY", async () => {
    expect((await app.inject({ method: "POST", url: "/api/store/prep-times", payload: { deliveryMinutes: 30, pickupMinutes: 20 } })).statusCode).toBe(401);
    // a loja de teste nasce PRO (helper); aqui volta ao teste grátis VENCIDO para entrar em Consulta/Suspensão
    await prisma.subscription.updateMany({ data: { status: "TRIAL", planId: null, currentPeriodEnd: null, trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
    const refused = await save({ deliveryMinutes: 30, pickupMinutes: 20 });
    expect(refused.statusCode).toBe(403);
    expect(json(refused).code).toBe("READ_ONLY");
  });

  it("a vitrine em Suspensão não vaza o prazo (503 neutro)", async () => {
    await save({ deliveryMinutes: 30, pickupMinutes: 20 });
    // a loja de teste nasce PRO (helper); aqui volta ao teste grátis VENCIDO para entrar em Consulta/Suspensão
    await prisma.subscription.updateMany({ data: { status: "TRIAL", planId: null, currentPeriodEnd: null, trialEndsAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
    const menu = await app.inject({ method: "GET", url: "/stores/loja-prep/menu" });
    expect(menu.statusCode).toBe(503);
    expect(menu.body).not.toContain("prepMinutes");
  });
});
