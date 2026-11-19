// DADOS-1 (i2 + i3): UMA função de período no fuso da loja e o comparativo com o período anterior; testes-guarda de conciliação.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { delta } from "../src/lib/reportComparison";
import { previousPeriod, resolveReportPeriod, type ReportPeriod } from "../src/lib/reportPeriod";
import { resolvePeriod } from "../src/modules/orders/orders.history";
import { makeApp, registerStore, resetDb } from "./helpers";

const MANAUS = "America/Manaus"; // UTC−4
const NORONHA = "America/Noronha"; // UTC−2
const NEW_YORK = "America/New_York"; // tem horário de verão: o dia 2026-03-08 tem 23 h
const ok = (r: ReturnType<typeof resolveReportPeriod>): ReportPeriod => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("resolveReportPeriod (i2): fuso da loja, fim inclusivo, nenhum '+24 h'", () => {
  it.each([
    ["2026-11-19T00:07:00Z", MANAUS, "2026-11-18"],
    ["2026-11-19T02:59:00Z", MANAUS, "2026-11-18"],
    ["2026-11-19T03:01:00Z", MANAUS, "2026-11-18"],
    ["2026-11-19T23:59:00Z", MANAUS, "2026-11-19"],
    ["2026-11-19T00:07:00Z", NORONHA, "2026-11-18"],
    ["2026-11-19T02:59:00Z", NORONHA, "2026-11-19"],
    ["2026-11-19T03:01:00Z", NORONHA, "2026-11-19"],
    ["2026-11-19T23:59:00Z", NORONHA, "2026-11-19"],
  ])("'hoje' em %s na loja %s é o dia %s", (agora, tz, dia) => {
    const p = ok(resolveReportPeriod({ preset: "today" }, new Date(agora), tz));
    expect([p.fromDate, p.toDate, p.timeZone]).toEqual([dia, dia, tz]);
    expect(p.partial).toBe(true);
  });

  it("a janela de um dia é 00:00 local → 00:00 local do dia seguinte (23 h no dia que o horário de verão começa)", () => {
    const p = ok(resolveReportPeriod({ from: "2026-03-08", to: "2026-03-08" }, new Date("2026-06-01T12:00:00Z"), NEW_YORK));
    expect((p.toExclusiveUtc.getTime() - p.fromUtc.getTime()) / 3_600_000).toBe(23);
    expect(p.partial).toBe(false);
    expect(p.days).toBe(1);
  });

  it("presets: ontem, 7d, 30d, mês atual e mês passado (datas civis da loja)", () => {
    const now = new Date("2026-03-01T01:00:00Z"); // Manaus: 28/02 21:00
    const d = (preset: string) => { const p = ok(resolveReportPeriod({ preset }, now, MANAUS)); return [p.fromDate, p.toDate]; };
    expect(d("today")).toEqual(["2026-02-28", "2026-02-28"]);
    expect(d("yesterday")).toEqual(["2026-02-27", "2026-02-27"]);
    expect(d("7d")).toEqual(["2026-02-22", "2026-02-28"]);
    expect(d("30d")).toEqual(["2026-01-30", "2026-02-28"]);
    expect(d("thisMonth")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(d("lastMonth")).toEqual(["2026-01-01", "2026-01-31"]);
    expect(resolveReportPeriod({ preset: "xyz" }, now, MANAUS)).toEqual({ error: "INVALID_DATE" });
  });

  it("o histórico de pedidos usa a MESMA função: mesmos instantes que o relatório", () => {
    const now = new Date("2026-11-19T02:30:00Z");
    for (const tz of [MANAUS, NORONHA]) {
      const r = ok(resolveReportPeriod({ preset: "7d" }, now, tz));
      const h = resolvePeriod({ period: "7d" }, now, tz);
      expect([h.start.toISOString(), h.end.toISOString()]).toEqual([r.fromUtc.toISOString(), r.toExclusiveUtc.toISOString()]);
    }
  });
});

describe("previousPeriod e delta (i3 / M13)", () => {
  it("período de vários dias: o anterior tem o MESMO número de dias, colado antes", () => {
    const now = new Date("2026-11-19T15:00:00Z");
    const cur = ok(resolveReportPeriod({ from: "2026-11-10", to: "2026-11-16" }, now, MANAUS));
    const prev = previousPeriod(cur, now);
    expect([prev.fromDate, prev.toDate, prev.days]).toEqual(["2026-11-03", "2026-11-09", 7]);
    expect(prev.toExclusiveUtc.toISOString()).toBe(cur.fromUtc.toISOString());
  });

  it("'hoje' compara com o MESMO dia da semana passado, até a mesma hora", () => {
    const now = new Date("2026-11-18T18:30:00Z"); // quarta, 14:30 em Manaus
    const cur = ok(resolveReportPeriod({ preset: "today" }, now, MANAUS));
    const prev = previousPeriod(cur, now);
    expect(prev.fromDate).toBe("2026-11-11"); // quarta passada
    expect(prev.toExclusiveUtc.toISOString()).toBe("2026-11-11T18:30:00.000Z"); // 14:30 locais
    expect(prev.partial).toBe(false);
  });

  it("delta = atual − anterior; % só se anterior > 0; anterior zero vira 'novo'", () => {
    expect(delta(150, 100)).toEqual({ current: 150, previous: 100, delta: 50, percent: 50, isNew: false });
    expect(delta(50, 100).percent).toBe(-50);
    expect(delta(1, 3).percent).toBe(-66.7);
    expect(delta(10, 0)).toEqual({ current: 10, previous: 0, delta: 10, percent: null, isNew: true });
    expect(delta(0, 0)).toEqual({ current: 0, previous: 0, delta: 0, percent: null, isNew: false });
  });
});

describe("GET /api/reports/summary?compare=prev", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => { app = makeApp(); });
  afterEach(async () => { vi.useRealTimers(); await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function loja(timezone: string, agora: string) {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(agora) });
    await app.ready();
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string };
    await prisma.store.update({ where: { id: store.id }, data: { timezone } });
    return { owner: cookie!, storeId: store.id };
  }
  let seq = 0;
  const pedido = (storeId: string, createdAt: string, totalCents: number, extra: Record<string, unknown> = {}) =>
    prisma.order.create({ data: { storeId, code: `P${++seq}`, type: "BALCAO", status: "CONFIRMADO", subtotalCents: totalCents, totalCents, paymentMethod: "PIX", createdAt: new Date(createdAt), ...extra } });

  it("loja em Manaus: período anterior de mesmo tamanho, delta e conciliação (total = soma das partes)", async () => {
    const ctx = await loja(MANAUS, "2026-11-19T15:00:00Z"); // 11:00 em Manaus
    // atual 15–16/11 (Manaus); anterior 13–14/11. Fronteira: 2026-11-15T03:59Z ainda é dia 14 em Manaus.
    await pedido(ctx.storeId, "2026-11-15T04:00:00Z", 6000); // 15/11 00:00 local → atual
    await pedido(ctx.storeId, "2026-11-16T12:00:00Z", 4000); // atual
    await pedido(ctx.storeId, "2026-11-15T03:59:00Z", 2000); // 14/11 23:59 local → anterior
    await pedido(ctx.storeId, "2026-11-13T12:00:00Z", 2000); // anterior
    await pedido(ctx.storeId, "2026-11-12T12:00:00Z", 9999); // fora das duas janelas
    const r = await app.inject({ method: "GET", url: "/api/reports/summary?from=2026-11-15&to=2026-11-16&compare=prev", headers: { cookie: ctx.owner } });
    const body = json(r);
    expect(body.timeZone).toBe(MANAUS);
    expect(body.comparison.previous).toMatchObject({ fromDate: "2026-11-13", toDate: "2026-11-14", timeZone: MANAUS });
    expect(body.comparison.orderCount).toEqual({ current: 2, previous: 2, delta: 0, percent: 0, isNew: false });
    expect(body.comparison.revenueCents).toEqual({ current: 10000, previous: 4000, delta: 6000, percent: 150, isNew: false });
    // conciliação: o total do resumo é a soma das partes
    expect(body.revenueCents).toBe(10000);
    expect(body.byDay.reduce((s: number, d: { revenueCents: number }) => s + d.revenueCents, 0)).toBe(body.revenueCents);
    expect(Object.values(body.byPaymentMethod as Record<string, { revenueCents: number }>).reduce((s, b) => s + b.revenueCents, 0)).toBe(body.revenueCents);
    expect(Object.values(body.byType as Record<string, { revenueCents: number }>).reduce((s, b) => s + b.revenueCents, 0)).toBe(body.revenueCents);
    expect(body.byDay.reduce((s: number, d: { orderCount: number }) => s + d.orderCount, 0)).toBe(body.orderCount);
  });

  it("sem compare=prev nada muda (campo 'comparison' ausente) e anterior zero vira 'novo' sem %", async () => {
    const ctx = await loja(NORONHA, "2026-11-19T15:00:00Z");
    await pedido(ctx.storeId, "2026-11-18T15:00:00Z", 3000);
    const sem = json(await app.inject({ method: "GET", url: "/api/reports/summary?from=2026-11-18&to=2026-11-18", headers: { cookie: ctx.owner } }));
    expect(sem.comparison).toBeUndefined();
    const com = json(await app.inject({ method: "GET", url: "/api/reports/summary?from=2026-11-18&to=2026-11-18&compare=prev", headers: { cookie: ctx.owner } }));
    expect(com.comparison.revenueCents).toEqual({ current: 3000, previous: 0, delta: 3000, percent: null, isNew: true });
  });

  it("'hoje' vem parcial e compara com o mesmo dia da semana passado até a mesma hora", async () => {
    const ctx = await loja(MANAUS, "2026-11-18T18:30:00Z"); // quarta 14:30 em Manaus
    await pedido(ctx.storeId, "2026-11-18T16:00:00Z", 5000); // hoje 12:00 local
    await pedido(ctx.storeId, "2026-11-11T16:00:00Z", 2000); // quarta passada 12:00 local → conta
    await pedido(ctx.storeId, "2026-11-11T20:00:00Z", 7000); // quarta passada 16:00 local → DEPOIS das 14:30: fora
    const body = json(await app.inject({ method: "GET", url: "/api/reports/summary?preset=today&compare=prev", headers: { cookie: ctx.owner } }));
    expect(body.partial).toBe(true);
    expect(body.fromDate).toBe("2026-11-18");
    expect(body.comparison.previous.fromDate).toBe("2026-11-11");
    expect(body.comparison.revenueCents).toMatchObject({ current: 5000, previous: 2000, percent: 150 });
  });

  it("STAFF recebe só contagens no comparativo (sem valores em reais)", async () => {
    const ctx = await loja(MANAUS, "2026-11-19T15:00:00Z");
    const owner = await prisma.user.findFirstOrThrow({ where: { storeId: ctx.storeId } });
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await prisma.user.create({ data: { storeId: ctx.storeId, email, passwordHash: owner.passwordHash, role: "STAFF" } });
    const lg = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "senha12345" } });
    const cookie = (lg.headers["set-cookie"] as string).split(";")[0];
    await pedido(ctx.storeId, "2026-11-18T15:00:00Z", 3000);
    const r = json(await app.inject({ method: "GET", url: "/api/reports/summary?from=2026-11-18&to=2026-11-18&compare=prev", headers: { cookie } }));
    expect(r.comparison.orderCount.current).toBe(1);
    for (const k of ["revenueCents", "averageTicketCents", "discountCents"]) expect(r.comparison[k]).toBeUndefined();
    expect(r.revenueCents).toBeUndefined();
  });

  it("isolamento: pedidos de outra loja não entram no atual nem no anterior", async () => {
    const a = await loja(MANAUS, "2026-11-19T15:00:00Z");
    await pedido(a.storeId, "2026-11-18T15:00:00Z", 1000);
    await pedido(a.storeId, "2026-11-17T15:00:00Z", 1000);
    const outra = await registerStore(app);
    const idB = json(outra.response).store.id as string;
    await pedido(idB, "2026-11-18T15:00:00Z", 50000);
    await pedido(idB, "2026-11-17T15:00:00Z", 50000);
    const r = json(await app.inject({ method: "GET", url: "/api/reports/summary?from=2026-11-18&to=2026-11-18&compare=prev", headers: { cookie: a.owner } }));
    expect(r.comparison.revenueCents).toMatchObject({ current: 1000, previous: 1000 });
  });
});

describe("guardas de fonte única do módulo de dados", () => {
  const root = path.resolve(__dirname, "..", "..", "..");
  const read = (p: string) => readFileSync(path.join(root, p), "utf8");

  it("período e comparativo não têm fuso escrito à mão nem '+ 24 h' solto", () => {
    for (const f of ["apps/api/src/lib/reportPeriod.ts", "apps/api/src/lib/reportComparison.ts", "apps/api/src/lib/reports.ts"]) {
      const t = read(f);
      expect(t, f).not.toMatch(/America\//);
      expect(t, f).not.toMatch(/\+\s*24\s*\*\s*60|\+\s*86_?400|\+\s*DAY\b/);
    }
  });

  it("o histórico de pedidos não reimplementa o período (usa resolveReportPeriod)", () => {
    expect(read("apps/api/src/modules/orders/orders.history.ts")).toContain("resolveReportPeriod");
  });

  it("nenhum indicador é calculado no navegador: só a definição de venda existente divide receita; delta/% de comparativo não nasce no web", () => {
    const webFiles: string[] = [];
    const walk = (dir: string) => {
      for (const name of require("node:fs").readdirSync(dir) as string[]) {
        if (["node_modules", ".next", "tests", "coverage"].includes(name)) continue;
        const full = path.join(dir, name);
        if (require("node:fs").statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) webFiles.push(full);
      }
    };
    walk(path.join(root, "apps", "web"));
    const re = /(revenueCents|totalCents|orderCount)\s*\/\s*|(percent|pct|variation|delta)\w*\s*=.*(revenue|orderCount)/g;
    const hits = webFiles.map((f) => [path.relative(root, f).replace(/\\/g, "/"), (readFileSync(f, "utf8").match(re) ?? []).length] as const).filter(([, n]) => n > 0);
    // catraca: hoje só salesDefinition.ts (1). Não pode subir; quando migrar para a API, REDUZA.
    expect(hits).toEqual([["apps/web/features/inicio/services/salesDefinition.ts", 1]]);
  });
});
