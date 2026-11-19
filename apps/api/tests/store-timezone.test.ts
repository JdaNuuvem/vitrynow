// PR-04 / SSOT D1 — o dia e a hora da API vêm de `Store.timezone`, não de um fuso fixo. Lojas em America/Manaus (UTC−4) e America/Noronha (UTC−2),
// com o relógio nas viradas que derrubaram o CI (00:07Z, 02:59Z, 03:01Z, 23:59Z): relatório do dia, caixa, esgotado até as 04:00, validade do cupom.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { nextSoldOutReset } from "../src/lib/soldOut";
import { endOfStoreDay, isBeforeToday, storeToday } from "../src/lib/storeDay";
import { DEFAULT_STORE_TIMEZONE, safeTimeZone } from "../src/lib/storeTime";
import { makeApp, registerStore, resetDb } from "./helpers";

const MANAUS = "America/Manaus"; // UTC−4 o ano todo
const NORONHA = "America/Noronha"; // UTC−2 o ano todo

describe("fuso da loja — funções puras nas viradas do dia", () => {
  // [instante, dia local em Manaus, dia local em Noronha, dia local no padrão (São Paulo, UTC−3)]
  const CASOS: [string, string, string, string][] = [
    ["2026-11-19T00:07:00Z", "2026-11-18", "2026-11-18", "2026-11-18"],
    ["2026-11-19T02:59:00Z", "2026-11-18", "2026-11-19", "2026-11-18"],
    ["2026-11-19T03:01:00Z", "2026-11-18", "2026-11-19", "2026-11-19"],
    ["2026-11-19T23:59:00Z", "2026-11-19", "2026-11-19", "2026-11-19"],
  ];
  it.each(CASOS)("storeToday em %s: Manaus %s, Noronha %s, padrão %s", (quando, manaus, noronha, padrao) => {
    const now = new Date(quando);
    expect(storeToday(now, MANAUS)).toBe(manaus);
    expect(storeToday(now, NORONHA)).toBe(noronha);
    expect(storeToday(now)).toBe(padrao);
    expect(storeToday(now, "Lixo/Invalido")).toBe(padrao); // fuso inválido cai no padrão, nunca derruba
  });

  it("esgotado 'até hoje' volta às 04:00 do fuso da LOJA (estritamente depois de agora)", () => {
    // Manaus: 04:00 = 08:00Z; Noronha: 04:00 = 06:00Z; padrão: 07:00Z
    expect(nextSoldOutReset(new Date("2026-11-19T00:07:00Z"), MANAUS).toISOString()).toBe("2026-11-19T08:00:00.000Z");
    expect(nextSoldOutReset(new Date("2026-11-19T00:07:00Z"), NORONHA).toISOString()).toBe("2026-11-19T06:00:00.000Z");
    expect(nextSoldOutReset(new Date("2026-11-19T07:59:00Z"), MANAUS).toISOString()).toBe("2026-11-19T08:00:00.000Z");
    expect(nextSoldOutReset(new Date("2026-11-19T08:00:00Z"), MANAUS).toISOString()).toBe("2026-11-20T08:00:00.000Z"); // exatamente na hora: o PRÓXIMO
    expect(nextSoldOutReset(new Date("2026-11-19T06:00:00Z"), NORONHA).toISOString()).toBe("2026-11-20T06:00:00.000Z");
    expect(nextSoldOutReset(new Date("2026-11-19T23:59:00Z"), NORONHA).toISOString()).toBe("2026-11-20T06:00:00.000Z");
    expect(nextSoldOutReset(new Date("2026-11-19T00:07:00Z")).toISOString()).toBe("2026-11-19T07:00:00.000Z"); // sem fuso: padrão
  });

  it("'vale até' é o fim do dia LOCAL (23:59:59.999) e só dia anterior ao de hoje da loja é passado", () => {
    expect(endOfStoreDay("2026-11-18", MANAUS).toISOString()).toBe("2026-11-19T03:59:59.999Z");
    expect(endOfStoreDay("2026-11-18", NORONHA).toISOString()).toBe("2026-11-19T01:59:59.999Z");
    expect(endOfStoreDay("2026-11-18").toISOString()).toBe("2026-11-19T02:59:59.999Z"); // padrão = UTC−3
    const agora = new Date("2026-11-19T02:30:00Z"); // Manaus ainda é 18 (22:30); Noronha já é 19 (00:30)
    expect(isBeforeToday("2026-11-18", agora, MANAUS)).toBe(false);
    expect(isBeforeToday("2026-11-18", agora, NORONHA)).toBe(true);
  });

  it("o padrão do produto existe em UM lugar e é o que o fuso inválido devolve", () => {
    expect(safeTimeZone(null)).toBe(DEFAULT_STORE_TIMEZONE);
    expect(safeTimeZone("nao/existe")).toBe(DEFAULT_STORE_TIMEZONE);
    expect(safeTimeZone(MANAUS)).toBe(MANAUS);
  });
});

describe("fuso da loja — rotas com o relógio e o fuso da loja", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function loja(timezone: string, agora: string) {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(agora) });
    await app.ready();
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    await prisma.store.update({ where: { id: store.id }, data: { timezone } });
    return { owner: cookie!, storeId: store.id, slug: store.slug };
  }

  // Mesmo instante (19/11 02:30Z): em Manaus é 18/11 22:30; em Noronha é 19/11 00:30.
  const AGORA = "2026-11-19T02:30:00Z";
  it.each([
    [MANAUS, "2026-11-18", "2026-11-19"],
    [NORONHA, "2026-11-19", "2026-11-18"],
  ])("relatório do dia (%s): o pedido cai no dia %s da loja e não no %s; o relatório declara o fuso", async (tz, diaCerto, diaErrado) => {
    const ctx = await loja(tz, AGORA);
    await prisma.order.create({
      data: { storeId: ctx.storeId, code: "0001", type: "BALCAO", status: "CONFIRMADO", subtotalCents: 5000, totalCents: 5000, paymentMethod: "PIX", createdAt: new Date(AGORA) },
    });
    const rel = async (dia: string) => json(await app.inject({ method: "GET", url: `/api/reports/summary?from=${dia}&to=${dia}`, headers: { cookie: ctx.owner } }));
    const certo = await rel(diaCerto);
    expect(certo.timeZone).toBe(tz);
    expect(certo.revenueCents).toBe(5000);
    expect(certo.byDay.map((d: { date: string }) => d.date)).toEqual([diaCerto]);
    expect((await rel(diaErrado)).revenueCents).toBe(0);
    // sem datas: "hoje" é o dia da LOJA
    const padrao = json(await app.inject({ method: "GET", url: "/api/reports/summary", headers: { cookie: ctx.owner } }));
    expect(padrao.toDate).toBe(diaCerto);
  });

  it.each([
    [MANAUS, 201],
    [NORONHA, 400],
  ])("validade do cupom '2026-11-18' às 02:30Z (%s): status %i (ontem para quem já virou o dia)", async (tz, status) => {
    const ctx = await loja(tz, AGORA);
    const r = await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.owner }, payload: { code: "VALE", discountType: "PERCENT", discountValue: 10, maxUses: 5, expiresAt: "2026-11-18" } });
    expect(r.statusCode).toBe(status);
    if (status === 400) expect(json(r).code).toBe("COUPON_EXPIRY_INVALID");
    else expect(new Date(json(r).coupon.expiresAt).toISOString()).toBe("2026-11-19T03:59:59.999Z"); // fim do dia 18 em Manaus
  });

  it.each([
    [MANAUS, "2026-11-19T08:00:00.000Z"],
    [NORONHA, "2026-11-19T06:00:00.000Z"],
  ])("esgotado 'até hoje' às 02:30Z (%s) volta em %s", async (tz, volta) => {
    const ctx = await loja(tz, AGORA);
    const categoryId = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: ctx.owner }, payload: { name: "X" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: ctx.owner }, payload: { categoryId, name: "P", priceCents: 1000 } })).product.id;
    const r = await app.inject({ method: "POST", url: `/api/catalog/products/${productId}/sold-out`, headers: { cookie: ctx.owner }, payload: { soldOut: true } });
    expect(r.statusCode).toBe(200);
    expect(new Date(json(r).product.soldOutUntil).toISOString()).toBe(volta);
  });

  it.each([MANAUS, NORONHA])("caixa (%s): abre e o resumo sai com o fuso da loja", async (tz) => {
    const ctx = await loja(tz, AGORA);
    expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload: { openingBalanceCents: 10000 } })).statusCode).toBe(201);
    const atual = await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: ctx.owner } });
    expect(atual.statusCode).toBe(200);
    expect(json(atual).expectedBalanceCents).toBe(10000);
  });
});
