// DADOS i6: GET /api/reports/by-hour e /by-weekday (BASICO): 24 e 7 posições, hora da LOJA, horário de verão, conciliação com o resumo.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { reportSeriesSchema } from "@meucardapio/shared-types";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("pico por hora e por dia da semana (i6)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });
  let seq = 0;
  const pedido = (storeId: string, createdAt: string, totalCents: number) =>
    prisma.order.create({ data: { storeId, code: `H${++seq}`, type: "BALCAO", status: "CONCLUIDO", subtotalCents: totalCents, totalCents, paymentMethod: "PIX", createdAt: new Date(createdAt) } });
  async function loja(timezone: string, plan: "BASICO" | "PRO" = "BASICO") {
    const r = await registerStore(app, { plan });
    const storeId = json(r.response).store.id as string;
    await prisma.store.update({ where: { id: storeId }, data: { timezone } });
    return { storeId, cookie: r.cookie! };
  }
  const get = async (cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });

  it("BASICO acessa; sempre 24 horas e 7 dias, zero explícito; hora e dia são os da loja (Manaus UTC−4)", async () => {
    const { storeId, cookie } = await loja("America/Manaus"); // plano BASICO: sem trava
    await pedido(storeId, "2026-11-16T03:30:00Z", 1000); // segunda 16/11 às 23:30 de DOMINGO 15/11 em Manaus → hora 23, domingo
    await pedido(storeId, "2026-11-16T18:00:00Z", 2000); // segunda 14:00 local
    const h = await get(cookie, "/api/reports/by-hour?from=2026-11-15&to=2026-11-16");
    expect(h.statusCode).toBe(200);
    const hora = reportSeriesSchema.parse(json(h)) as { byHour: { hour: number; orderCount: number; revenueCents: number }[] };
    expect(hora.byHour.map((p) => p.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(hora.byHour[23]).toMatchObject({ orderCount: 1, revenueCents: 1000 });
    expect(hora.byHour[14]).toMatchObject({ orderCount: 1, revenueCents: 2000 });
    expect(hora.byHour[3]).toEqual({ hour: 3, orderCount: 0, revenueCents: 0 }); // zero confirmado
    const w = json(await get(cookie, "/api/reports/by-weekday?from=2026-11-15&to=2026-11-16"));
    expect(w.byWeekday).toHaveLength(7);
    expect(w.byWeekday[6]).toMatchObject({ weekday: 7, orderCount: 1 }); // domingo
    expect(w.byWeekday[0]).toMatchObject({ weekday: 1, orderCount: 1 }); // segunda
    expect(w.timeZone).toBe("America/Manaus");
  });

  it("conciliação: a soma das 24 horas e dos 7 dias = total do resumo do mesmo período", async () => {
    const { storeId, cookie } = await loja("America/Noronha");
    for (const [t, v] of [["2026-11-10T01:10:00Z", 500], ["2026-11-11T12:00:00Z", 700], ["2026-11-12T23:59:00Z", 900]] as const) await pedido(storeId, t, v);
    const q = "from=2026-11-09&to=2026-11-13";
    const sum = json(await get(cookie, `/api/reports/summary?${q}`));
    const h = json(await get(cookie, `/api/reports/by-hour?${q}`)).byHour as { orderCount: number; revenueCents: number }[];
    const w = json(await get(cookie, `/api/reports/by-weekday?${q}`)).byWeekday as { orderCount: number; revenueCents: number }[];
    for (const s of [h, w]) {
      expect(s.reduce((a, p) => a + p.orderCount, 0)).toBe(sum.orderCount);
      expect(s.reduce((a, p) => a + p.revenueCents, 0)).toBe(sum.revenueCents);
    }
  });

  it("horário de verão (loja em New York): 08/03/2026 a hora 02 não existe (0) e 01/11/2026 a hora 01 repete (soma na mesma posição)", async () => {
    const { storeId, cookie } = await loja("America/New_York");
    await pedido(storeId, "2026-03-08T06:30:00Z", 100); // 01:30 EST
    await pedido(storeId, "2026-03-08T07:30:00Z", 100); // 03:30 EDT (a 02:xx nunca existiu)
    const mar = json(await get(cookie, "/api/reports/by-hour?from=2026-03-08&to=2026-03-08")).byHour as { hour: number; orderCount: number }[];
    expect(mar[1].orderCount).toBe(1);
    expect(mar[2].orderCount).toBe(0);
    expect(mar[3].orderCount).toBe(1);
    await pedido(storeId, "2026-11-01T05:30:00Z", 100); // 01:30 EDT
    await pedido(storeId, "2026-11-01T06:30:00Z", 100); // 01:30 EST (a mesma hora local, repetida)
    const nov = json(await get(cookie, "/api/reports/by-hour?from=2026-11-01&to=2026-11-01")).byHour as { hour: number; orderCount: number }[];
    expect(nov[1].orderCount).toBe(2);
  });

  it("STAFF só contagens; sem sessão 401; isolamento entre lojas", async () => {
    const a = await loja("America/Sao_Paulo");
    const owner = await prisma.user.findFirstOrThrow({ where: { storeId: a.storeId } });
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await prisma.user.create({ data: { storeId: a.storeId, email, passwordHash: owner.passwordHash, role: "STAFF" } });
    const lg = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "senha12345" } });
    const staff = (lg.headers["set-cookie"] as string).split(";")[0];
    await pedido(a.storeId, "2026-11-10T15:00:00Z", 4000);
    const b = await loja("America/Sao_Paulo");
    await pedido(b.storeId, "2026-11-10T15:00:00Z", 9000);
    const r = json(await get(staff, "/api/reports/by-hour?from=2026-11-10&to=2026-11-10")).byHour as Record<string, number>[];
    expect(r[12]).toEqual({ hour: 12, orderCount: 1 }); // sem revenueCents
    const dono = json(await get(a.cookie, "/api/reports/by-hour?from=2026-11-10&to=2026-11-10")).byHour as Record<string, number>[];
    expect(dono[12].revenueCents).toBe(4000); // a venda da loja B (9000) não entra
    expect((await app.inject({ method: "GET", url: "/api/reports/by-weekday" })).statusCode).toBe(401);
  });
});
