// API-17 (B11): "Esgotado hoje" — CA-B11-01/02/04/05/06/07. A volta na abertura da grade (B5) entra com a API-11.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { isSoldOutNow, nextSoldOutReset } from "../src/lib/soldOut";
import { makeApp, registerStore, resetDb, enablePro } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("esgotado hoje (B11)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
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

  async function setup(slug: string, code: string) {
    const { cookie } = await registerStore(app, { slug, code });
    const category = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "Lanches" } })).category;
    const product = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: category.id, name: "Combo", priceCents: 1500 } })).product;
    return { cookie: cookie!, slug, productId: product.id as string };
  }
  const staffCookie = async (owner: string) => {
    await enablePro(app, owner);
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email: `staff-${Math.random().toString(36).slice(2, 8)}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  };
  const soldOut = (cookie: string, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/catalog/products/${id}/sold-out`, headers: { cookie }, payload });
  const order = (slug: string, productId: string) => app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 1 }] } });
  const menuProducts = async (slug: string) => json(await app.inject({ method: "GET", url: `/stores/${slug}/menu` })).categories.flatMap((c: { products: unknown[] }) => c.products) as { id: string; soldOut: boolean }[];

  it("regra de tempo: volta às 04:00 do fuso da loja (CA-B11-01/07); sem data = até reativar (CA-B11-06)", () => {
    // 14:00 em São Paulo = 17:00Z → volta amanhã 04:00 SP = 07:00Z do dia seguinte
    expect(nextSoldOutReset(new Date("2026-11-18T17:00:00Z")).toISOString()).toBe("2026-11-19T07:00:00.000Z");
    // 02:00 em São Paulo (05:00Z) ainda é "hoje": volta às 04:00 SP do mesmo dia
    expect(nextSoldOutReset(new Date("2026-11-18T05:00:00Z")).toISOString()).toBe("2026-11-18T07:00:00.000Z");
    // exatamente 04:00 SP: vale o próximo, nunca o instante atual
    expect(nextSoldOutReset(new Date("2026-11-18T07:00:00Z")).toISOString()).toBe("2026-11-19T07:00:00.000Z");
    const until = new Date("2026-11-19T07:00:00Z");
    expect(isSoldOutNow({ soldOut: true, soldOutUntil: until }, new Date("2026-11-19T06:59:59Z"))).toBe(true);
    expect(isSoldOutNow({ soldOut: true, soldOutUntil: until }, new Date("2026-11-19T07:00:00Z"))).toBe(false);
    expect(isSoldOutNow({ soldOut: true, soldOutUntil: null }, new Date("2030-01-01T00:00:00Z"))).toBe(true);
    expect(isSoldOutNow({ soldOut: false, soldOutUntil: null })).toBe(false);
  });

  it("CA-B11-02: esgotado aparece cinza no cardápio e o pedido direto na API é 400 ITEM_UNAVAILABLE; reativar libera", async () => {
    const { cookie, slug, productId } = await setup("so-a", "SA1");
    const on = await soldOut(cookie, productId, { soldOut: true });
    expect(on.statusCode).toBe(200);
    expect(json(on).product.soldOutUntil).not.toBeNull();
    expect((await menuProducts(slug)).find((p) => p.id === productId)?.soldOut).toBe(true);
    const refused = await order(slug, productId);
    expect(refused.statusCode).toBe(400);
    expect(json(refused).code).toBe("ITEM_UNAVAILABLE");
    expect(json(refused).details.items[0].id).toBe(productId);
    expect(await prisma.order.count()).toBe(0);

    expect((await soldOut(cookie, productId, { soldOut: false })).statusCode).toBe(200);
    expect((await menuProducts(slug)).find((p) => p.id === productId)?.soldOut).toBe(false);
    expect((await order(slug, productId)).statusCode).toBe(201);
  });

  it("volta sozinho: soldOutUntil no passado deixa de valer (CA-B11-01); 'até eu reativar' não expira (CA-B11-06)", async () => {
    const { cookie, slug, productId } = await setup("so-b", "SB1");
    await soldOut(cookie, productId, { soldOut: true });
    await prisma.product.update({ where: { id: productId }, data: { soldOutUntil: new Date(Date.now() - 60_000) } });
    expect((await menuProducts(slug))[0].soldOut).toBe(false);
    expect((await order(slug, productId)).statusCode).toBe(201);

    const manual = await soldOut(cookie, productId, { soldOut: true, duration: "MANUAL" });
    expect(json(manual).product.soldOutUntil).toBeNull();
    expect((await menuProducts(slug))[0].soldOut).toBe(true);
    expect((await order(slug, productId)).statusCode).toBe(400);
  });

  it("CA-B11-04: 'esconder esgotados' tira o produto do cardápio e a API continua recusando", async () => {
    const { cookie, slug, productId } = await setup("so-c", "SC1");
    await soldOut(cookie, productId, { soldOut: true });
    const set = await app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie }, payload: { hideSoldOutProducts: true } });
    expect(set.statusCode).toBe(200);
    expect(json(set).store.hideSoldOutProducts).toBe(true);
    expect(await menuProducts(slug)).toHaveLength(0);
    expect((await order(slug, productId)).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie }, payload: { hideSoldOutProducts: false } });
    expect(await menuProducts(slug)).toHaveLength(1);
  });

  it("CA-B11-05: STAFF pode acionar e fica na auditoria (quem, quando, produto); corpo inválido = 400; sem login = 401", async () => {
    const { cookie, productId } = await setup("so-d", "SD1");
    const staff = await staffCookie(cookie);
    expect((await soldOut(staff, productId, { soldOut: true })).statusCode).toBe(200);
    // a auditoria é gravada sem esperar (fire-and-forget): espera aparecer
    let logs = await prisma.auditLog.findMany({ where: { action: "product.sold_out", targetId: productId } });
    for (let i = 0; i < 20 && logs.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      logs = await prisma.auditLog.findMany({ where: { action: "product.sold_out", targetId: productId } });
    }
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).not.toBeNull();
    expect((logs[0].metadata as { name: string }).name).toBe("Combo");
    expect((await soldOut(cookie, productId, { soldOut: "sim" })).statusCode).toBe(400);
    expect((await soldOut(cookie, productId, { soldOut: true, duration: "SEMPRE" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/catalog/products/${productId}/sold-out`, payload: { soldOut: true } })).statusCode).toBe(401);
  });

  it("isolamento: a loja B não esgota nem enxerga o produto da loja A (404, nada alterado)", async () => {
    const a = await setup("so-e", "SE1");
    const b = await setup("so-f", "SF1");
    expect((await soldOut(b.cookie, a.productId, { soldOut: true })).statusCode).toBe(404);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.productId } })).soldOut).toBe(false);
    expect((await order(a.slug, a.productId)).statusCode).toBe(201);
  });
});
