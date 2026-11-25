// API-40 (PRO) — pedido agendado: criação retida (fora do kanban/impressão), validação do horário, loja fechada agora aceita,
// plano, liberação pelo job `schedule.release` (idempotente, só pago, não solta cancelado) e PIX aprovado que continua retido.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { registeredJobs } from "../src/jobs/registry";
import { scheduleReleaseJob } from "../src/jobs/scheduleRelease";
import { checkScheduledFor, releaseAtFor, SCHEDULE_MAX_DAYS, SCHEDULE_MIN_LEAD_MINUTES } from "../src/lib/scheduling";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, registerStore, resetDb } from "./helpers";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const inMin = (n: number, from = new Date()) => new Date(from.getTime() + n * 60_000);

describe("API-40 — regras puras do horário", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  const base = { now, schedule: null, timeZone: "America/Sao_Paulo", closedUntil: null };
  it("antecedência mínima, máximo de dias, 'fechado até' e liberação pelo tempo de preparo", () => {
    expect(checkScheduledFor({ ...base, scheduledFor: inMin(SCHEDULE_MIN_LEAD_MINUTES - 1, now) })?.code).toBe("SCHEDULE_TOO_SOON");
    expect(checkScheduledFor({ ...base, scheduledFor: inMin(SCHEDULE_MIN_LEAD_MINUTES, now) })).toBeNull();
    expect(checkScheduledFor({ ...base, scheduledFor: inMin(SCHEDULE_MAX_DAYS * 24 * 60 + 1, now) })?.code).toBe("SCHEDULE_TOO_FAR");
    expect(checkScheduledFor({ ...base, scheduledFor: inMin(120, now), closedUntil: inMin(180, now) })?.code).toBe("SCHEDULE_OUTSIDE_HOURS");
    expect(releaseAtFor(inMin(120, now), 40)).toEqual(inMin(80, now));
  });
  it("fora da grade semanal é recusado; dentro é aceito", () => {
    const week = Array.from({ length: 7 }, () => [{ start: "18:00", end: "23:00" }]);
    const schedule = { week, exceptions: [], cutoffMinutes: 0 } as never;
    // 20/11/2026 15:00Z = 12:00 em São Paulo; 22:00Z = 19:00 local
    expect(checkScheduledFor({ ...base, schedule, scheduledFor: new Date("2026-11-20T16:00:00Z") })?.code).toBe("SCHEDULE_OUTSIDE_HOURS");
    expect(checkScheduledFor({ ...base, schedule, scheduledFor: new Date("2026-11-20T22:00:00Z") })).toBeNull();
  });
  it("o job está registrado", () => {
    expect(registeredJobs.map((j) => j.name)).toContain("schedule.release");
  });
});

describe("API-40 — pedido agendado (integração)", () => {
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

  async function loja(plan: "PRO" | "BASICO" = "PRO") {
    const { cookie, response } = await registerStore(app, { plan });
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
    await prisma.store.update({ where: { id: store.id }, data: { prepMinutesPickup: 20 } });
    return { owner: cookie!, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const pedir = (l: Loja, extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: l.productId, quantity: 1 }], ...extra } });
  const kanbanIds = async (l: Loja) => (json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: l.owner } })).orders as { id: string }[]).map((o) => o.id);
  const agenda = async (l: Loja) => json(await app.inject({ method: "GET", url: "/api/orders/scheduled", headers: { cookie: l.owner } })).orders as { id: string; scheduledFor: string }[];
  const soltar = (now: Date) => scheduleReleaseJob.runOnce({ now, db: prisma, log, limit: 100 });

  it("FELIZ: nasce retido (fora do kanban, sem tíquete, na agenda); o job solta 20 min (preparo) antes do horário, uma vez só", async () => {
    const l = await loja();
    const when = inMin(120);
    const r = await pedir(l, { scheduledFor: when.toISOString() });
    expect(r.statusCode, r.body).toBe(201);
    const id = json(r).orderId as string;
    expect(await prisma.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ held: true, scheduledFor: when });
    expect(await kanbanIds(l)).not.toContain(id);
    expect(await prisma.printJob.count({ where: { orderId: id } })).toBe(0);
    expect((await agenda(l)).map((o) => o.id)).toEqual([id]);

    expect((await soltar(inMin(99))).processed).toBe(0); // 120 - 20 = 100 min: ainda não
    expect((await soltar(inMin(101))).processed).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).held).toBe(false);
    expect(await kanbanIds(l)).toContain(id);
    expect(await agenda(l)).toEqual([]);
    expect((await soltar(inMin(102))).processed).toBe(0); // idempotente
  });

  it("concorrência: duas execuções ao mesmo tempo soltam o pedido UMA vez", async () => {
    const l = await loja();
    await pedir(l, { scheduledFor: inMin(60).toISOString() });
    const [a, b] = await Promise.all([soltar(inMin(200)), soltar(inMin(200))]);
    expect(a.processed + b.processed).toBe(1);
  });

  it("loja PAUSADA agora aceita agendado (o horário escolhido está na grade); pedido imediato continua recusado; MESA não agenda", async () => {
    const l = await loja();
    await prisma.store.update({ where: { id: l.store.id }, data: { pausedUntil: inMin(60) } });
    expect(json(await pedir(l)).code).toBe("STORE_CLOSED");
    expect((await pedir(l, { scheduledFor: inMin(180).toISOString() })).statusCode).toBe(201);
    expect(json(await pedir(l, { type: "MESA", scheduledFor: inMin(180).toISOString() })).code).toBe("SCHEDULE_NOT_ALLOWED");
  });

  it("horário inválido: cedo demais, longe demais, 'fechado até', formato ruim", async () => {
    const l = await loja();
    expect(json(await pedir(l, { scheduledFor: inMin(10).toISOString() })).code).toBe("SCHEDULE_TOO_SOON");
    expect(json(await pedir(l, { scheduledFor: inMin(8 * 24 * 60).toISOString() })).code).toBe("SCHEDULE_TOO_FAR");
    await prisma.store.update({ where: { id: l.store.id }, data: { closedUntil: inMin(24 * 60) } });
    expect(json(await pedir(l, { scheduledFor: inMin(120).toISOString() })).code).toBe("SCHEDULE_OUTSIDE_HOURS");
    expect((await pedir(l, { scheduledFor: "amanhã às 8" })).statusCode).toBe(400);
    expect(await prisma.order.count()).toBe(0);
  });

  it("cardápio público diz se a loja agenda (`store.scheduling`), sem citar plano", async () => {
    const pro = await loja();
    const basico = await loja("BASICO");
    const menu = async (l: Loja) => json(await app.inject({ method: "GET", url: `/stores/${l.store.slug}/menu` })).store;
    expect((await menu(pro)).scheduling).toBe(true);
    expect((await menu(basico)).scheduling).toBe(false);
    expect(JSON.stringify(await menu(basico))).not.toMatch(/PRO|BASICO|plano/);
  });

  it("fora do PRO: 409 SCHEDULING_UNAVAILABLE sem citar plano; nada gravado", async () => {
    const l = await loja("BASICO");
    const r = await pedir(l, { scheduledFor: inMin(120).toISOString() });
    expect([r.statusCode, json(r).code]).toEqual([409, "SCHEDULING_UNAVAILABLE"]);
    expect(json(r).error).not.toMatch(/plano|PRO/i);
    expect(await prisma.order.count()).toBe(0);
  });

  it("não solta: pedido cancelado nem pedido aguardando PIX; PIX aprovado continua retido até o horário", async () => {
    const l = await loja();
    const cancelado = json(await pedir(l, { scheduledFor: inMin(60).toISOString() })).orderId as string;
    await app.inject({ method: "POST", url: `/api/orders/${cancelado}/cancel`, headers: { cookie: l.owner }, payload: { reason: { code: "AGENDAMENTO_NAO_ATENDIDO" } } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: cancelado } })).status).toBe("CANCELADO");

    const pix = json(await pedir(l, { scheduledFor: inMin(60).toISOString() })).orderId as string;
    await prisma.order.update({ where: { id: pix }, data: { awaitingPayment: true, paymentMethod: "PIX" } });
    expect((await soltar(inMin(200))).processed).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: cancelado } })).held).toBe(true);
    expect(await agenda(l)).toEqual([]); // cancelado e aguardando PIX não aparecem na agenda

    // pagamento aprovado: sai do "aguardando", mas segue retido e sem tíquete até o job
    await prisma.order.update({ where: { id: pix }, data: { awaitingPayment: false, paidAt: new Date() } });
    expect(await prisma.printJob.count({ where: { orderId: pix } })).toBe(0);
    expect((await soltar(inMin(200))).processed).toBe(1);
  });
});
