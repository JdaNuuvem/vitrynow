import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { localParts } from "../src/modules/storeHours/storeHours.domain";
import { makeApp, registerStore, resetDb } from "./helpers";

// B5/API-11 em HTTP: o servidor decide se a loja recebe pedido (CA-B5-01/04/05/09/10, RN-B5-01/03/04/06/11/12).
// O relógio é o real; por isso a grade é montada RELATIVA a agora (janela que começa daqui a 2 h).

const DAY = 24 * 60 * 60 * 1000;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// Grade que NUNCA cobre o instante atual: todos os dias, uma janela de 1 h começando daqui a 2 h (fuso da loja).
function closedNowSchedule(timezone = "America/Sao_Paulo") {
  const start = (localParts(new Date(), timezone).minutes + 120) % 1440;
  const interval = { start: hhmm(start), end: hhmm((start + 60) % 1440) };
  return { week: Array.from({ length: 7 }, () => [interval]), exceptions: [], cutoffMinutes: 0 };
}
const openNowSchedule = () => ({ week: Array.from({ length: 7 }, () => [{ start: "00:00", end: "24:00" }]), exceptions: [], cutoffMinutes: 0 });

describe("horário de funcionamento (API-11)", () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  let productId: string;

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    cookie = (await registerStore(app, { slug: "loja-hr", code: "HR1" })).cookie!;
    const category = await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie }, payload: { name: "Lanches" } });
    const product = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie },
      payload: { categoryId: JSON.parse(category.body).category.id, name: "Combo", priceCents: 1500 },
    });
    productId = JSON.parse(product.body).product.id;
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (response: { body: string }) => JSON.parse(response.body);
  const order = () =>
    app.inject({ method: "POST", url: "/stores/loja-hr/orders", payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1 }] } });
  const menu = async () => json(await app.inject({ method: "GET", url: "/stores/loja-hr/menu" })).store;
  const saveHours = (schedule: unknown) => app.inject({ method: "POST", url: "/api/store/hours", headers: { cookie }, payload: { schedule } });
  const setStatus = (payload: unknown) => app.inject({ method: "POST", url: "/api/store/status", headers: { cookie }, payload });
  const getHours = async () => json(await app.inject({ method: "GET", url: "/api/store/hours", headers: { cookie } })).hours;

  it("CA-B5-09 / RN-B5-06: loja sem grade segue aberta quando ligada, e o painel sabe que não há grade", async () => {
    const hours = await getHours();
    expect(hours).toMatchObject({ configured: false, schedule: null, timezone: "America/Sao_Paulo", status: { status: "ABERTO", reason: null } });
    expect((await order()).statusCode).toBe(201);
    expect(await menu()).toMatchObject({ accepting: true, hours: { status: "ABERTO" } });
  });

  it("CA-B5-01: fora do horário o pedido é recusado com 409 STORE_CLOSED, motivo e próxima abertura; o cardápio continua visível", async () => {
    expect((await saveHours(closedNowSchedule())).statusCode).toBe(200);

    const response = await order();
    expect(response.statusCode).toBe(409);
    expect(json(response)).toMatchObject({ code: "STORE_CLOSED", details: { reason: "OUTSIDE_HOURS", nextOpenAt: expect.any(String) } });
    expect(json(response).error).toMatch(/^Abrimos (hoje|amanhã) às \d\d:\d\d$/);
    expect(new Date(json(response).details.nextOpenAt).getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.order.count()).toBe(0);

    const store = await menu(); // RN-B5-03: ver o cardápio sempre pode
    expect(store).toMatchObject({ accepting: false, hours: { status: "FECHADO", reason: "OUTSIDE_HOURS" } });
    expect(JSON.stringify(store)).not.toMatch(/subscription|phase/i);
  });

  it("grade aberta agora aceita o pedido", async () => {
    expect((await saveHours(openNowSchedule())).statusCode).toBe(200);
    expect((await order()).statusCode).toBe(201);
    expect(await menu()).toMatchObject({ accepting: true, hours: { status: "ABERTO", message: "Aberto" } });
  });

  it("CA-B5-04: pausar 30 min recusa com PAUSED e RESUME volta na hora", async () => {
    const paused = await setStatus({ action: "PAUSE", minutes: 30 });
    expect(paused.statusCode).toBe(200);
    expect(json(paused).hours.status).toMatchObject({ status: "PAUSADO", reason: "PAUSED" });
    expect(Date.parse(json(paused).hours.pausedUntil) - Date.now()).toBeGreaterThan(29 * 60_000);

    const refused = await order();
    expect(refused.statusCode).toBe(409);
    expect(json(refused)).toMatchObject({ code: "STORE_CLOSED", details: { reason: "PAUSED" } });
    expect(await menu()).toMatchObject({ accepting: false, hours: { status: "PAUSADO" } });

    expect(json(await setStatus({ action: "RESUME" })).hours.status.status).toBe("ABERTO");
    expect((await order()).statusCode).toBe(201);
  });

  it("pausa por tempo vencido deixa de valer sozinha (sem job)", async () => {
    await prisma.store.updateMany({ data: { pausedUntil: new Date(Date.now() - 1000) } });
    expect((await order()).statusCode).toBe(201);
  });

  it("CA-B5-05: fechar por hoje sem grade vai até a meia-noite local e recusa com CLOSED_TODAY", async () => {
    const closed = await setStatus({ action: "CLOSE_TODAY" });
    expect(closed.statusCode).toBe(200);
    expect(json(closed).hours.status).toMatchObject({ status: "FECHADO", reason: "CLOSED_TODAY" });
    expect(Date.parse(json(closed).hours.closedUntil) - Date.now()).toBeLessThanOrEqual(DAY);

    expect(json(await order())).toMatchObject({ code: "STORE_CLOSED", details: { reason: "CLOSED_TODAY" } });
  });

  it("fechar por hoje com grade vai até a próxima abertura dela", async () => {
    const schedule = closedNowSchedule();
    await saveHours(schedule);
    const hours = json(await setStatus({ action: "CLOSE_TODAY" })).hours;
    expect(hours.closedUntil).toBe(hours.status.nextOpenAt);
    expect(Date.parse(hours.closedUntil)).toBeGreaterThan(Date.now());
  });

  it("'Desligar até eu ligar' (acceptingOrders=false) recusa com SWITCHED_OFF", async () => {
    await app.inject({ method: "POST", url: "/api/store/availability", headers: { cookie }, payload: { acceptingOrders: false } });
    expect(json(await order())).toMatchObject({ code: "STORE_CLOSED", details: { reason: "SWITCHED_OFF", nextOpenAt: null } });
    expect((await menu()).hours).toMatchObject({ status: "FECHADO", reason: "SWITCHED_OFF" });
  });

  it("CA-B5-10: intervalos sobrepostos devolvem 400 com a mensagem do conflito e nada é gravado", async () => {
    const week = Array.from({ length: 7 }, () => [
      { start: "11:00", end: "15:00" },
      { start: "14:00", end: "18:00" },
    ]);
    const response = await saveHours({ week, exceptions: [], cutoffMinutes: 0 });
    expect(response.statusCode).toBe(400);
    expect(json(response)).toMatchObject({ code: "SCHEDULE_INVALID", error: expect.stringContaining("se sobrepõem") });
    expect(json(response).problems.length).toBeGreaterThan(0);
    expect((await getHours()).configured).toBe(false);
  });

  it("formato inválido (horário fora do padrão, semana incompleta) devolve 400 de validação", async () => {
    expect((await saveHours({ week: [[]], exceptions: [], cutoffMinutes: 0 })).statusCode).toBe(400);
    expect((await saveHours({ week: Array.from({ length: 7 }, () => [{ start: "25:00", end: "26:00" }]) })).statusCode).toBe(400);
    expect((await setStatus({ action: "PAUSE", minutes: 7 })).statusCode).toBe(400);
    expect((await setStatus({ action: "EXPLODIR" })).statusCode).toBe(400);
  });

  it("RN-B5-12: salvar grava auditoria com antes e depois; exceções passadas são arquivadas", async () => {
    const schedule = { ...openNowSchedule(), exceptions: [{ date: "2020-01-01", closed: true }, { date: "2099-12-25", closed: true }] };
    const saved = await saveHours(schedule);
    expect(json(saved).hours.schedule.exceptions).toEqual([{ date: "2099-12-25", closed: true }]);

    // logAudit é assíncrono (não bloqueia a resposta): espera até 10 s pelo registro
    let audit = null;
    for (let i = 0; i < 50 && !audit; i++) {
      audit = await prisma.auditLog.findFirst({ where: { action: "store.hours_update" } });
      if (!audit) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!audit) throw new Error("auditoria store.hours_update não foi gravada");
    expect(audit.metadata).toMatchObject({ before: null, after: { cutoffMinutes: 0 } });
  });

  it("apagar a grade (null) volta ao comportamento sem grade", async () => {
    await saveHours(closedNowSchedule());
    expect((await order()).statusCode).toBe(409);
    expect((await saveHours(null)).statusCode).toBe(200);
    expect((await order()).statusCode).toBe(201);
  });

  it("RN-B5-11: trocar o fuso da loja recalcula o estado na hora", async () => {
    // Janela de 1 h que começa daqui a 2 h NO FUSO DE SÃO PAULO: em Tóquio (+12 h) o mesmo horário local é outro instante.
    await saveHours(closedNowSchedule("America/Sao_Paulo"));
    const inSp = (await getHours()).status;
    await prisma.store.updateMany({ data: { timezone: "Asia/Tokyo" } });
    const inTokyo = (await getHours()).status;
    expect(inSp.nextOpenAt).not.toBe(inTokyo.nextOpenAt);
  });

  it("RN-B5-01: a assinatura vence o horário — em Consulta o motivo é SUBSCRIPTION_INACTIVE, mesmo com a loja fechada pela grade", async () => {
    await saveHours(closedNowSchedule());
    await prisma.subscription.updateMany({ data: { trialEndsAt: new Date(Date.now() - DAY) } }); // Consulta
    const response = await order();
    expect(response.statusCode).toBe(409);
    expect(json(response).code).toBe("SUBSCRIPTION_INACTIVE");
  });

  it("na Consulta não se altera horário nem se pausa a loja (403 READ_ONLY); a leitura segue", async () => {
    await prisma.subscription.updateMany({ data: { trialEndsAt: new Date(Date.now() - DAY) } });
    expect(json(await saveHours(openNowSchedule())).code).toBe("READ_ONLY");
    expect(json(await setStatus({ action: "RESUME" })).code).toBe("READ_ONLY");
    expect((await app.inject({ method: "GET", url: "/api/store/hours", headers: { cookie } })).statusCode).toBe(200);
  });

  it("só o OWNER salva a grade; sem login é 401", async () => {
    expect((await app.inject({ method: "POST", url: "/api/store/hours", payload: { schedule: null } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/store/hours" })).statusCode).toBe(401);
  });
});
