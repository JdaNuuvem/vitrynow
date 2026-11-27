// SEC-15 / RN-B2-06: o limite de desconto manual do STAFF e configurado so pelo OWNER, dentro de 0..100, com auditoria, e vale no pedido manual.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("SEC-15 - limite de desconto manual do STAFF", { timeout: 60_000 }, () => {
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
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "Pizza", priceCents: 4000 } })).product.id as string;
    const email = `s-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email, password: "provisoria-12" } });
    const staff = ((await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria-12" } })).headers["set-cookie"] as string).split(";")[0];
    return { owner: cookie!, staff, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const limite = (cookie: string | undefined, body: unknown) => app.inject({ method: "PUT", url: "/api/store/manual-discount-limit", headers: cookie ? { cookie } : {}, payload: body as object });
  const pedido = (l: Loja, percent: number, cookie: string) =>
    app.inject({ method: "POST", url: "/api/orders", headers: { cookie }, payload: { type: "BALCAO", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "DINHEIRO", discount: { percent, reason: "CORTESIA" } } });

  it("GET devolve o limite em vigor para dono e equipe; visitante 401", async () => {
    const l = await loja();
    const ler = (cookie?: string) => app.inject({ method: "GET", url: "/api/store/manual-discount-limit", headers: cookie ? { cookie } : {} });
    expect(json(await ler(l.owner))).toEqual({ limitPercent: 10 });
    await limite(l.owner, { limitPercent: 25 });
    expect(json(await ler(l.staff))).toEqual({ limitPercent: 25 });
    expect((await ler()).statusCode).toBe(401);
  });

  it("STAFF e visitante NAO mudam o limite (403/401) e o valor continua o mesmo", async () => {
    const l = await loja();
    const r = await limite(l.staff, { limitPercent: 100 });
    expect(r.statusCode).toBe(403);
    expect((await limite(undefined, { limitPercent: 100 })).statusCode).toBe(401);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: l.store.id } })).manualDiscountStaffLimitPercent).toBe(10);
  });

  it("OWNER muda o limite, a mudanca e auditada e passa a valer para o STAFF (sobe e desce)", async () => {
    const l = await loja();
    expect((await pedido(l, 20, l.staff)).statusCode).toBe(403);
    const ok = await limite(l.owner, { limitPercent: 25 });
    expect([ok.statusCode, json(ok).limitPercent]).toEqual([200, 25]);
    expect((await pedido(l, 20, l.staff)).statusCode).toBe(201);
    expect((await pedido(l, 30, l.staff)).statusCode).toBe(403);
    await limite(l.owner, { limitPercent: 0 }); // 0 = STAFF sem desconto algum
    const zero = await pedido(l, 1, l.staff);
    expect([zero.statusCode, json(zero).code, json(zero).limitPercent]).toEqual([403, "DISCOUNT_ABOVE_LIMIT", 0]);
    expect((await pedido(l, 50, l.owner)).statusCode).toBe(201); // OWNER sem teto
    // auditoria gravada sem bloquear a resposta (logAudit): espera aparecer
    await vi.waitFor(async () => {
      const aud = await prisma.auditLog.findMany({ where: { storeId: l.store.id, action: "store.manual_discount_limit_change" }, orderBy: { createdAt: "asc" } });
      expect(aud.map((a) => a.metadata)).toMatchObject([{ fromPercent: 10, toPercent: 25 }, { fromPercent: 25, toPercent: 0 }]);
    }, { timeout: 10_000, interval: 100 });
  });

  it("valor fora da faixa ou de tipo errado e 400 e nao grava", async () => {
    const l = await loja();
    for (const bad of [-1, 101, 10.5, "50", null, undefined]) {
      const r = await limite(l.owner, { limitPercent: bad });
      expect([r.statusCode, json(r).code], String(bad)).toEqual([400, "VALIDATION_ERROR"]);
    }
    expect((await prisma.store.findUniqueOrThrow({ where: { id: l.store.id } })).manualDiscountStaffLimitPercent).toBe(10);
  });

  it("isolamento: o dono da loja A nao muda o limite da loja B", async () => {
    const a = await loja();
    const b = await loja();
    await limite(a.owner, { limitPercent: 40 });
    expect((await prisma.store.findUniqueOrThrow({ where: { id: b.store.id } })).manualDiscountStaffLimitPercent).toBe(10);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: a.store.id } })).manualDiscountStaffLimitPercent).toBe(40);
  });
});
