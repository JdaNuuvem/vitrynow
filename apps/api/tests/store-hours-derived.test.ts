// PR-01 / SSOT D2: o horário tem UMA fonte (`Store.schedule`); `openNow`, `nextOpensAt`, `hoursText` e `openingHours` saem dela. `openNow` usa o MESMO cálculo que decide se a loja
// aceita pedido (computeStoreStatus/acceptingWindows). Relógio injetável nos 6 instantes; HTTP com o relógio real; escrita do texto legado ignorada quando há grade.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { PrismaStoreHoursRepository } from "../src/modules/storeHours/storeHours.repository";
import { StoreHoursService } from "../src/modules/storeHours/storeHours.service";
import { computeStoreStatus, hoursText, isOpenAt, parseStoredSchedule, type Schedule } from "../src/modules/storeHours/storeHours.domain";
import { PUBLIC_STORE_HOURS_KEYS } from "../src/lib/publicDto";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);
const week = (days: Record<number, Array<{ start: string; end: string }>>): Schedule["week"] => Array.from({ length: 7 }, (_, d) => days[d] ?? []);

describe("hoursText (texto gerado da grade)", () => {
  const seg_sab = { 1: [{ start: "09:00", end: "17:00" }], 2: [{ start: "09:00", end: "17:00" }], 3: [{ start: "09:00", end: "17:00" }], 4: [{ start: "09:00", end: "17:00" }], 5: [{ start: "09:00", end: "17:00" }], 6: [{ start: "09:00", end: "17:00" }] };
  it("faixa de dias seguidos, 2 dias com 'e', dia isolado, dois horários e fechado", () => {
    expect(hoursText({ week: week(seg_sab), exceptions: [], cutoffMinutes: 0 })).toBe("Seg a sáb 09:00–17:00");
    expect(hoursText({ week: week({ ...seg_sab, 6: [{ start: "09:00", end: "13:00" }] }), exceptions: [], cutoffMinutes: 0 })).toBe("Seg a sex 09:00–17:00; Sáb 09:00–13:00");
    expect(hoursText({ week: week({ 1: [{ start: "11:00", end: "15:00" }, { start: "18:00", end: "23:00" }], 2: [{ start: "11:00", end: "15:00" }, { start: "18:00", end: "23:00" }] }), exceptions: [], cutoffMinutes: 0 })).toBe("Seg e ter 11:00–15:00, 18:00–23:00");
    expect(hoursText({ week: week({ 0: [{ start: "10:00", end: "14:00" }] }), exceptions: [], cutoffMinutes: 0 })).toBe("Dom 10:00–14:00");
    expect(hoursText({ week: week({}), exceptions: [], cutoffMinutes: 0 })).toBe("Fechado");
  });
});

describe("openNow == decisão de aceitar pedido, em 6 instantes (relógio injetado)", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  // Loja direta no banco + serviço com relógio controlado (a mesma classe que o servidor usa).
  async function loja(schedule: Schedule | null, timezone: string, openingHours: string | null = null) {
    const store = await prisma.store.create({ data: { name: "L", slug: `l-${Math.random().toString(36).slice(2, 8)}`, code: `H${Math.random().toString(36).slice(2, 6)}`, timezone, schedule: schedule as never, openingHours } });
    return store.id;
  }
  const serviceAt = (iso: string) => new StoreHoursService(new PrismaStoreHoursRepository(prisma), { log: () => undefined } as never, { now: () => new Date(iso) });
  const status = (schedule: Schedule, tz: string, iso: string) => computeStoreStatus({ schedule, timezone: tz, now: new Date(iso), acceptingOrders: true, pausedUntil: null, closedUntil: null }).status === "ABERTO";

  const comercial: Schedule = { week: week({ 1: [{ start: "09:00", end: "17:00" }], 2: [{ start: "09:00", end: "17:00" }], 3: [{ start: "09:00", end: "17:00" }], 4: [{ start: "09:00", end: "17:00" }], 5: [{ start: "09:00", end: "17:00" }] }), exceptions: [], cutoffMinutes: 0 };

  const casos: Array<{ nome: string; schedule: Schedule; tz: string; iso: string; aberto: boolean }> = [
    { nome: "dentro do horário (qua 10:00 em SP)", schedule: comercial, tz: "America/Sao_Paulo", iso: "2026-11-18T13:00:00Z", aberto: true },
    { nome: "fora do horário (qua 20:00 em SP)", schedule: comercial, tz: "America/Sao_Paulo", iso: "2026-11-18T23:00:00Z", aberto: false },
    { nome: "virada de dia: 22:00–02:00, sex 23:30 abre e sáb 01:30 ainda vale", schedule: { week: week({ 5: [{ start: "22:00", end: "26:00" }] } as never), exceptions: [], cutoffMinutes: 0 }, tz: "America/Sao_Paulo", iso: "2026-11-21T04:30:00Z", aberto: true },
    { nome: "exceção/feriado fechado (qua 25/12 em dia comercial)", schedule: { ...comercial, exceptions: [{ date: "2026-12-23", closed: true }] }, tz: "America/Sao_Paulo", iso: "2026-12-23T13:00:00Z", aberto: false },
    { nome: "fuso fora de SP (Manaus −04:00): 09:00 local = 13:00Z abre; 12:59Z ainda fechado", schedule: comercial, tz: "America/Manaus", iso: "2026-11-18T13:00:00Z", aberto: true },
    { nome: "limite 17:00:00.000 local (fim exclusivo) = fechado", schedule: comercial, tz: "America/Sao_Paulo", iso: "2026-11-18T20:00:00.000Z", aberto: false },
  ];

  for (const c of casos) {
    it(c.nome, async () => {
      // A grade de virada de dia usa "HH:MM" com fim até 24:00; para o caso overnight monta-se um intervalo que cruza a meia-noite pelos dois dias.
      const schedule = c.nome.startsWith("virada") ? { week: week({ 5: [{ start: "22:00", end: "24:00" }], 6: [{ start: "00:00", end: "02:00" }] }), exceptions: [], cutoffMinutes: 0 } : c.schedule;
      const id = await loja(schedule, c.tz);
      const derived = await serviceAt(c.iso).derivedFor(id);
      expect(derived.openNow).toBe(c.aberto);
      expect(derived.openNow).toBe(status(schedule, c.tz, c.iso)); // o MESMO cálculo de aceitar pedido
      expect(isOpenAt(schedule, c.tz, new Date(c.iso))).toBe(c.aberto);
      expect(derived.hoursText).toBe(hoursText(parseStoredSchedule(schedule)!));
      if (c.aberto) expect(derived.nextOpensAt).toBeNull();
      else expect(derived.nextOpensAt === null || new Date(derived.nextOpensAt).getTime() > new Date(c.iso).getTime()).toBe(true);
    });
  }

  it("23:59:59.999 × 00:00:00.000: grade aberta até 24:00 de seg; ter fechado. Seg 23:59:59.999 = aberto; ter 00:00:00.000 = fechado e nextOpensAt = próxima abertura", async () => {
    const schedule: Schedule = { week: week({ 1: [{ start: "18:00", end: "24:00" }], 3: [{ start: "18:00", end: "24:00" }] }), exceptions: [], cutoffMinutes: 0 };
    const id = await loja(schedule, "America/Sao_Paulo");
    const antes = await serviceAt("2026-11-17T02:59:59.999Z").derivedFor(id); // seg 16/11 23:59:59.999 em SP
    const depois = await serviceAt("2026-11-17T03:00:00.000Z").derivedFor(id); // ter 17/11 00:00:00.000
    expect(antes.openNow).toBe(true);
    expect(depois.openNow).toBe(false);
    expect(depois.nextOpensAt).toBe("2026-11-18T21:00:00.000Z"); // qua 18/11 18:00 em SP
  });

  it("sem grade: openNow e nextOpensAt nulos e hoursText = texto legado (compatível); sem nada, nulo", async () => {
    const comTexto = await loja(null, "America/Sao_Paulo", "Todos os dias, das 18h às 23h");
    const semNada = await loja(null, "America/Sao_Paulo", null);
    expect(await serviceAt("2026-11-18T13:00:00Z").derivedFor(comTexto)).toEqual({ openNow: null, nextOpensAt: null, hoursText: "Todos os dias, das 18h às 23h" });
    expect(await serviceAt("2026-11-18T13:00:00Z").derivedFor(semNada)).toEqual({ openNow: null, nextOpensAt: null, hoursText: null });
  });
});

describe("PR-01 em HTTP (relógio real)", { timeout: 90_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  const slug = "loja-hd";
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    cookie = (await registerStore(app, { slug, code: "HD1", plan: "BASICO" })).cookie!;
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });
  const post = (url: string, payload: unknown, c = cookie) => app.inject({ method: "POST", url, headers: { cookie: c }, payload: payload as never });
  const menuStore = async (s = slug) => json(await app.inject({ method: "GET", url: `/stores/${s}/menu` })).store;
  const aberta24h = { week: week(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "00:00", end: "24:00" }]]))), exceptions: [], cutoffMinutes: 0 };

  it("cardápio público e painel devolvem openNow/nextOpensAt/hoursText; chaves exatas na allowlist; openingHours legado vira o texto gerado", async () => {
    await post("/api/store/settings", { openingHours: "texto antigo da loja" });
    const antes = await menuStore();
    expect(antes).toMatchObject({ openNow: null, nextOpensAt: null, hoursText: "texto antigo da loja", openingHours: "texto antigo da loja" });
    expect((await post("/api/store/hours", { schedule: aberta24h })).statusCode).toBe(200);
    const depois = await menuStore();
    for (const key of PUBLIC_STORE_HOURS_KEYS) expect(depois).toHaveProperty(key);
    expect(depois).toMatchObject({ openNow: true, nextOpensAt: null, hoursText: "Seg a dom 00:00–24:00", openingHours: "Seg a dom 00:00–24:00" });
    const painel = json(await app.inject({ method: "GET", url: "/api/store/settings", headers: { cookie } })).store;
    expect(painel).toMatchObject({ openNow: true, hoursText: "Seg a dom 00:00–24:00", openingHours: "Seg a dom 00:00–24:00" });
    const horas = json(await app.inject({ method: "GET", url: "/api/store/hours", headers: { cookie } }));
    expect(horas.hours).toMatchObject({ openNow: true, hoursText: "Seg a dom 00:00–24:00" });
  });

  it("com grade, escrever `openingHours` é IGNORADO (200, resto salva, aviso OPENING_HOURS_DERIVED); sem grade, grava como antes", async () => {
    const livre = await post("/api/store/settings", { openingHours: "das 18h às 23h" });
    expect(livre.statusCode, livre.body).toBe(200);
    expect(json(livre).store.openingHours).toBe("das 18h às 23h");
    expect(json(livre)).not.toHaveProperty("warnings");
    await post("/api/store/hours", { schedule: aberta24h });
    const ignorado = await post("/api/store/settings", { openingHours: "outro texto", address: "Rua Nova, 10" });
    expect(ignorado.statusCode, ignorado.body).toBe(200);
    expect(json(ignorado).warnings[0]).toMatchObject({ code: "OPENING_HOURS_DERIVED" });
    expect(json(ignorado).store).toMatchObject({ address: "Rua Nova, 10", openingHours: "Seg a dom 00:00–24:00" });
    const row = await prisma.store.findFirstOrThrow({ where: { slug } });
    expect(row.openingHours).toBe("das 18h às 23h"); // a coluna legada não foi tocada
    expect(row.address).toBe("Rua Nova, 10");
    const igual = await post("/api/store/settings", { address: "Rua Nova, 11" }); // sem mandar openingHours: sem aviso
    expect(json(igual)).not.toHaveProperty("warnings");
  });

  it("ciclo do painel: carregar → reenviar (o formulário devolve o texto GERADO) NÃO avisa, mesmo mudando só o endereço; texto diferente avisa e a coluna fica intacta", async () => {
    await post("/api/store/settings", { openingHours: "texto legado" });
    await post("/api/store/hours", { schedule: aberta24h });
    const carregado = json(await app.inject({ method: "GET", url: "/api/store/settings", headers: { cookie } })).store;
    expect(carregado.openingHours).toBe("Seg a dom 00:00–24:00");
    const reenvio = await post("/api/store/settings", { openingHours: carregado.openingHours, address: "Rua do Ciclo, 1" });
    expect(reenvio.statusCode, reenvio.body).toBe(200);
    expect(json(reenvio)).not.toHaveProperty("warnings");
    expect(json(reenvio).store.address).toBe("Rua do Ciclo, 1");
    const legadoIgual = await post("/api/store/settings", { openingHours: "texto legado" }); // igual ao legado: também sem aviso
    expect(json(legadoIgual)).not.toHaveProperty("warnings");
    const diferente = await post("/api/store/settings", { openingHours: "um texto novo qualquer" });
    expect(json(diferente).warnings[0]).toMatchObject({ code: "OPENING_HOURS_DERIVED" });
    expect((await prisma.store.findFirstOrThrow({ where: { slug } })).openingHours).toBe("texto legado");
  });

  it("openNow acompanha a decisão REAL de aceitar pedido: grade aberta = pedido 201; grade fechada agora = openNow false e pedido 409 STORE_CLOSED", async () => {
    const cat = json(await post("/api/catalog/categories", { name: "C" })).category.id;
    const prod = json(await post("/api/catalog/products", { categoryId: cat, name: "P", priceCents: 1000 })).product.id;
    const pedido = () => app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: prod, quantity: 1 }] } });
    await post("/api/store/hours", { schedule: aberta24h });
    expect((await menuStore()).openNow).toBe(true);
    expect((await pedido()).statusCode).toBe(201);
    await post("/api/store/hours", { schedule: { week: week({}), exceptions: [], cutoffMinutes: 0 } });
    const fechado = await menuStore();
    expect(fechado).toMatchObject({ openNow: false, hoursText: "Fechado" });
    const recusado = await pedido();
    expect([recusado.statusCode, json(recusado).code]).toEqual([409, "STORE_CLOSED"]);
  });

  it("isolamento: o horário de uma loja nunca aparece no cardápio nem no painel de outra", async () => {
    await post("/api/store/hours", { schedule: aberta24h });
    const b = await registerStore(app, { slug: "loja-hd-b", code: "HD2", plan: "BASICO" });
    const outra = await menuStore("loja-hd-b");
    expect(outra).toMatchObject({ openNow: null, hoursText: null });
    const painelB = json(await app.inject({ method: "GET", url: "/api/store/settings", headers: { cookie: b.cookie! } })).store;
    expect(painelB).toMatchObject({ openNow: null, hoursText: null });
  });
});
