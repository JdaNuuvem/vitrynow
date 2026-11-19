// DADOS i4: GET /api/reports/products (mais e menos vendidos, identidade estável, peso em kg, papéis, isolamento).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { reportProductsSchema } from "@meucardapio/shared-types";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("GET /api/reports/products (i4)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });
  let seq = 0;
  const DIA = "2026-11-10";

  async function venda(storeId: string, itens: { productId: string | null; name: string; qty: number; unit: number; grams?: number }[]) {
    const total = itens.reduce((s, i) => s + i.unit * i.qty, 0);
    return prisma.order.create({
      data: {
        storeId, code: `Q${++seq}`, type: "BALCAO", status: "CONCLUIDO", subtotalCents: total, totalCents: total, paymentMethod: "PIX", createdAt: new Date(`${DIA}T15:00:00Z`),
        items: { create: itens.map((i) => ({ productId: i.productId, productName: i.name, quantity: i.qty, unitPriceCents: i.unit, weightGrams: i.grams ?? null })) },
      },
    });
  }
  const prod = async (storeId: string, name: string, categoryId: string | null) => (await prisma.product.create({ data: { storeId, name, priceCents: 1000, categoryId } })).id;

  it("ranking desc/asc por productId, com categoria, renomeado = uma linha, excluído = nome do pedido, peso em kg", async () => {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const cat = (await prisma.category.create({ data: { storeId, name: "Lanches" } })).id;
    const a = await prod(storeId, "X-Burguer", cat);
    const b = await prod(storeId, "Suco", cat);
    const kg = await prod(storeId, "Self-service", cat);
    await venda(storeId, [{ productId: a, name: "X-Burguer", qty: 3, unit: 2000 }]);
    await prisma.product.update({ where: { id: a }, data: { name: "X-Burguer Duplo" } }); // renomeado depois
    await venda(storeId, [{ productId: a, name: "X-Burguer Duplo", qty: 2, unit: 2000 }, { productId: b, name: "Suco", qty: 1, unit: 800 }]);
    await venda(storeId, [{ productId: null, name: "Item excluído", qty: 1, unit: 500 }]); // produto apagado: productId nulo
    await venda(storeId, [{ productId: kg, name: "Self-service", qty: 1, unit: 3500, grams: 450 }]);
    const desc = reportProductsSchema.parse(json(await app.inject({ method: "GET", url: `/api/reports/products?from=${DIA}&to=${DIA}`, headers: { cookie: cookie! } })));
    expect(desc.items[0]).toMatchObject({ productId: a, categoryId: cat, quantity: 5, orders: 2, soldBy: "UN", revenueCents: 10000 }); // renomeado = UMA linha
    const peso = desc.items.find((i) => i.productId === kg)!;
    expect(peso).toMatchObject({ soldBy: "KG", quantity: null, weightKg: 0.45, orders: 1 }); // nunca gramas como unidades
    expect(desc.items.some((i) => i.productId === null && i.name === "Item excluído")).toBe(true);
    expect(desc.completeness).toEqual({ partial: false, reasons: [] });
    const asc = json(await app.inject({ method: "GET", url: `/api/reports/products?from=${DIA}&to=${DIA}&order=asc&limit=1`, headers: { cookie: cookie! } }));
    expect(asc.items).toHaveLength(1);
    expect(asc.items[0].quantity === null || asc.items[0].quantity === 1).toBe(true); // o MENOS vendido primeiro
    expect(asc.items[0].productId).not.toBe(a);
  });

  it("erro: order/limit inválidos 400; sem sessão 401; isolamento: outra loja não entra", async () => {
    const A = await registerStore(app);
    const idA = json(A.response).store.id as string;
    expect((await app.inject({ method: "GET", url: "/api/reports/products" })).statusCode).toBe(401);
    for (const q of ["order=x", "limit=0", "limit=101", "limit=abc"]) expect((await app.inject({ method: "GET", url: `/api/reports/products?${q}`, headers: { cookie: A.cookie! } })).statusCode, q).toBe(400);
    const B = await registerStore(app);
    const idB = json(B.response).store.id as string;
    await venda(idB, [{ productId: null, name: "Só da loja B", qty: 9, unit: 100 }]);
    const r = json(await app.inject({ method: "GET", url: `/api/reports/products?from=${DIA}&to=${DIA}`, headers: { cookie: A.cookie! } }));
    expect(r.items).toEqual([]);
    expect(idA).not.toBe(idB);
  });

  it("STAFF vê só quantidade (sem receita em reais)", async () => {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const owner = await prisma.user.findFirstOrThrow({ where: { storeId } });
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await prisma.user.create({ data: { storeId, email, passwordHash: owner.passwordHash, role: "STAFF" } });
    const lg = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "senha12345" } });
    const staff = (lg.headers["set-cookie"] as string).split(";")[0];
    await venda(storeId, [{ productId: null, name: "Pizza", qty: 2, unit: 3000 }]);
    const r = json(await app.inject({ method: "GET", url: `/api/reports/products?from=${DIA}&to=${DIA}`, headers: { cookie: staff } }));
    expect(r.items[0]).toMatchObject({ name: "Pizza", quantity: 2 });
    expect(r.items[0].revenueCents).toBeUndefined();
    expect(cookie).toBeTruthy();
  });
});
