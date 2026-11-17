import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { activateSubscription } from "../src/lib/subscription";
import { normalizeName } from "../src/modules/catalog/catalog.service";
import { login, makeApp, registerStore, resetDb } from "./helpers";

// API-56 / PRD-13: catálogo base (CA-CT-01..05, 07, 09, 10, 13, 15, 16). Mercado Pago não entra aqui.

describe("normalizeName", () => {
  it("ignora maiúsculas, acentos e espaços repetidos", () => {
    expect(normalizeName("  Lânches ")).toBe("lanches");
    expect(normalizeName("PÃO   de  queijo")).toBe("pao de queijo");
  });
});

describe("catálogo base (API-56)", () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  let storeId: string;
  let slug: string;

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    const registered = await registerStore(app, { slug: "loja-cat", code: "CT1" });
    cookie = registered.cookie!;
    ({ id: storeId, slug } = JSON.parse(registered.response.body).store);
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  const post = (url: string, payload?: unknown, as = cookie) => app.inject({ method: "POST", url, headers: { cookie: as }, payload: payload as never });
  const category = async (name: string, as = cookie) => json(await post("/api/catalog/categories", { name }, as)).category as { id: string; position: number; name: string };
  const product = async (categoryId: string, name = "X-Burger", extra: Record<string, unknown> = {}) =>
    json(await post("/api/catalog/products", { categoryId, name, priceCents: 2800, ...extra })).product as { id: string; position: number; priceCents: number };
  const order = (productId: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1 }], ...extra } });
  const audit = async (action: string) => {
    for (let i = 0; i < 50; i++) {
      const row = await prisma.auditLog.findFirst({ where: { action }, orderBy: { createdAt: "desc" } });
      if (row) return row;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`auditoria ${action} não foi gravada`);
  };

  async function staffCookie() {
    await activateSubscription({ subscriptionId: (await prisma.subscription.findFirstOrThrow()).id, planCode: "PRO" });
    expect((await post("/api/users", { email: "staff-ct@teste.com", password: "senha-forte-123" })).statusCode).toBe(201);
    return (await login(app, "staff-ct@teste.com", "senha-forte-123")).cookie!;
  }

  it("CA-CT-01: produto sem categoria é 400 (categoryId obrigatório); com categoria de outra loja é 404", async () => {
    const response = await post("/api/catalog/products", { name: "Sem categoria", priceCents: 1000 });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(json(response).error)).toContain("categoryId");

    const other = await registerStore(app, { slug: "outra-loja", code: "CT2" });
    const foreign = await category("De outra loja", other.cookie!);
    expect((await post("/api/catalog/products", { categoryId: foreign.id, name: "Intruso", priceCents: 1 })).statusCode).toBe(404);
    expect(await prisma.product.count()).toBe(0);
  });

  it("featured não é aceito na escrita (RN-CT-14, CA-CT-15): enviado, é ignorado", async () => {
    const c = await category("Lanches");
    const created = await post("/api/catalog/products", { categoryId: c.id, name: "Destaque", priceCents: 100, featured: true });
    expect(created.statusCode).toBe(201);
    expect((await prisma.product.findFirstOrThrow()).featured).toBe(false);
  });

  it("CA-CT-02: nome de categoria repetido (maiúsculas/acentos) é 409 CATEGORY_NAME_TAKEN; renomear para si mesma é livre", async () => {
    const lanches = await category("Lanches");
    for (const name of ["lanches", "Lânches", "  LANCHES  "]) {
      const response = await post("/api/catalog/categories", { name });
      expect(response.statusCode, name).toBe(409);
      expect(json(response)).toMatchObject({ code: "CATEGORY_NAME_TAKEN", error: "Já existe uma categoria com esse nome." });
    }
    const other = await category("Bebidas");
    expect((await post(`/api/catalog/categories/${other.id}`, { name: "lanches" })).statusCode).toBe(409);
    expect((await post(`/api/catalog/categories/${lanches.id}`, { name: "LANCHES" })).statusCode).toBe(200);
    expect(await prisma.category.count()).toBe(2);
  });

  it("nomes iguais em lojas diferentes são permitidos", async () => {
    await category("Lanches");
    const other = await registerStore(app, { slug: "outra-loja", code: "CT2" });
    expect((await post("/api/catalog/categories", { name: "Lanches" }, other.cookie!)).statusCode).toBe(201);
  });

  it("CA-CT-04: excluir categoria com produtos é 409 CATEGORY_NOT_EMPTY com a contagem; 'Mover produtos para…' resolve", async () => {
    const from = await category("Lanches");
    const to = await category("Combos");
    const ids = [await product(from.id, "A"), await product(from.id, "B"), await product(from.id, "C")];
    await prisma.product.update({ where: { id: ids[1].id }, data: { active: false } }); // oculto também conta

    const blocked = await post(`/api/catalog/categories/${from.id}/delete`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked)).toMatchObject({ code: "CATEGORY_NOT_EMPTY", count: 3, hint: "MOVE_PRODUCTS" });
    expect(json(blocked).error).toContain("categoria tem 3 produto(s)");

    const moved = await post(`/api/catalog/categories/${from.id}/move-products`, { toCategoryId: to.id });
    expect(moved.statusCode).toBe(200);
    expect(json(moved)).toEqual({ moved: 3 });
    const inTarget = await prisma.product.findMany({ where: { categoryId: to.id }, orderBy: { position: "asc" } });
    expect(inTarget.map((p) => p.name)).toEqual(["A", "B", "C"]); // ordem relativa preservada
    expect(inTarget[1].active).toBe(false); // visibilidade preservada

    expect((await post(`/api/catalog/categories/${from.id}/delete`)).statusCode).toBe(200);
    expect(await prisma.product.count()).toBe(3); // nada foi apagado
    await audit("category.move_products");
  });

  it("mover produtos: destino de outra loja é 404, mesma categoria é 400, origem inexistente é 404", async () => {
    const from = await category("Lanches");
    await product(from.id);
    const other = await registerStore(app, { slug: "outra-loja", code: "CT2" });
    const foreign = await category("Alheia", other.cookie!);
    expect((await post(`/api/catalog/categories/${from.id}/move-products`, { toCategoryId: foreign.id })).statusCode).toBe(404);
    expect((await post(`/api/catalog/categories/${from.id}/move-products`, { toCategoryId: from.id })).statusCode).toBe(400);
    expect((await post(`/api/catalog/categories/nao-existe/move-products`, { toCategoryId: from.id })).statusCode).toBe(404);
    expect(await prisma.product.count({ where: { categoryId: from.id } })).toBe(1);
  });

  it("CA-CT-09: produto em pedido EM ABERTO não é excluído (409 PRODUCT_IN_OPEN_ORDERS); oculta-se no lugar", async () => {
    const c = await category("Lanches");
    const p = await product(c.id);
    expect((await order(p.id)).statusCode).toBe(201);
    expect((await order(p.id)).statusCode).toBe(201);

    const blocked = await post(`/api/catalog/products/${p.id}/delete`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked)).toMatchObject({ code: "PRODUCT_IN_OPEN_ORDERS", count: 2, hint: "HIDE_INSTEAD" });
    expect(await prisma.product.count()).toBe(1);

    expect((await post(`/api/catalog/products/${p.id}`, { active: false })).statusCode).toBe(200); // "ocultar em vez de excluir"
    expect((await prisma.product.findFirstOrThrow()).active).toBe(false);
  });

  it("pedido cancelado ou concluído não bloqueia a exclusão; a auditoria guarda nome e preço", async () => {
    const c = await category("Lanches");
    const p = await product(c.id);
    const o = json(await order(p.id)).orderId as string;
    await prisma.order.update({ where: { id: o }, data: { status: "CANCELADO" } });
    expect((await post(`/api/catalog/products/${p.id}/delete`)).statusCode).toBe(200);
    expect((await audit("product.delete")).metadata).toMatchObject({ name: "X-Burger", priceCents: 2800 });
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: o } })).productName).toBe("X-Burger");
  });

  it("CA-CT-13: STAFF não exclui produto nem categoria (403 FORBIDDEN_ROLE) mas edita preço", async () => {
    const c = await category("Lanches");
    const p = await product(c.id);
    const empty = await category("Vazia");
    const staff = await staffCookie();

    for (const url of [`/api/catalog/products/${p.id}/delete`, `/api/catalog/categories/${empty.id}/delete`]) {
      const response = await post(url, undefined, staff);
      expect(response.statusCode, url).toBe(403);
      expect(json(response).code).toBe("FORBIDDEN_ROLE");
    }
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.category.count()).toBe(2);
    expect((await post(`/api/catalog/products/${p.id}`, { priceCents: 3000 }, staff)).statusCode).toBe(200);
  });

  it("CA-CT-10 / RN-CT-13: mudar preço audita antes e depois; pedido antigo mantém o preço; sem mudança não audita", async () => {
    const c = await category("Lanches");
    const p = await product(c.id, "X-Burger", { priceCents: 2000 });
    const o = json(await order(p.id)).orderId as string;
    expect((await post(`/api/catalog/products/${p.id}`, { name: "X-Burger 2" })).statusCode).toBe(200);
    expect((await post(`/api/catalog/products/${p.id}`, { priceCents: 2200 })).statusCode).toBe(200);

    expect((await audit("product.price_change")).metadata).toMatchObject({ name: "X-Burger 2", beforeCents: 2000, afterCents: 2200 });
    expect(await prisma.auditLog.count({ where: { action: "product.price_change" } })).toBe(1);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: o } })).unitPriceCents).toBe(2000);
  });

  it("CA-CT-05: ordem — novo item entra no fim; reordenar categorias e produtos persiste e vale no cardápio", async () => {
    const a = await category("A");
    const b = await category("B");
    const c = await category("C");
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);

    expect((await post("/api/catalog/categories/reorder", { ids: [c.id, a.id, b.id] })).statusCode).toBe(200);
    const p1 = await product(a.id, "P1");
    const p2 = await product(a.id, "P2");
    const p3 = await product(a.id, "P3");
    expect([p1.position, p2.position, p3.position]).toEqual([0, 1, 2]);
    expect((await post("/api/catalog/products/reorder", { categoryId: a.id, ids: [p3.id, p1.id, p2.id] })).statusCode).toBe(200);

    const menu = json(await app.inject({ method: "GET", url: `/stores/${slug}/menu` }));
    expect(menu.categories.map((x: { name: string }) => x.name)).toEqual(["C", "A", "B"]);
    expect(menu.categories.find((x: { name: string }) => x.name === "A").products.map((x: { name: string }) => x.name)).toEqual(["P3", "P1", "P2"]);
  });

  it("reordenar com id de outra loja, repetido ou inexistente é 404 e nada muda", async () => {
    const a = await category("A");
    const b = await category("B");
    const other = await registerStore(app, { slug: "outra-loja", code: "CT2" });
    const foreign = await category("Alheia", other.cookie!);
    for (const ids of [[a.id, foreign.id], [a.id, a.id], ["nao-existe"]]) {
      expect((await post("/api/catalog/categories/reorder", { ids })).statusCode, JSON.stringify(ids)).toBe(404);
    }
    expect((await prisma.category.findUniqueOrThrow({ where: { id: b.id } })).position).toBe(1);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: foreign.id } })).position).toBe(0);
    expect((await post("/api/catalog/categories/reorder", { ids: [] })).statusCode).toBe(400);
  });

  it("CA-CT-16: o 501º produto é recusado (409 PRODUCT_LIMIT_REACHED) e nada é apagado", async () => {
    const c = await category("Lanches");
    await prisma.product.createMany({ data: Array.from({ length: 500 }, (_, i) => ({ storeId, categoryId: c.id, name: `P${i}`, priceCents: 100, position: i })) });
    const response = await post("/api/catalog/products", { categoryId: c.id, name: "501", priceCents: 100 });
    expect(response.statusCode).toBe(409);
    expect(json(response)).toMatchObject({ code: "PRODUCT_LIMIT_REACHED", max: 500 });
    expect(await prisma.product.count()).toBe(500);
  });

  it("a 51ª categoria é recusada (409 CATEGORY_LIMIT_REACHED)", async () => {
    await prisma.category.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ storeId, name: `C${i}`, position: i })) });
    const response = await post("/api/catalog/categories", { name: "C50" });
    expect(response.statusCode).toBe(409);
    expect(json(response)).toMatchObject({ code: "CATEGORY_LIMIT_REACHED", max: 50 });
  });

  it("preço negativo é recusado (CA-CT-07) e produto de outra loja não é editado nem movido (SEC-10/11)", async () => {
    const c = await category("Lanches");
    expect((await post("/api/catalog/products", { categoryId: c.id, name: "Neg", priceCents: -1 })).statusCode).toBe(400);
    const other = await registerStore(app, { slug: "outra-loja", code: "CT2" });
    const foreignCategory = await category("Alheia", other.cookie!);
    const p = await product(c.id);
    expect((await post(`/api/catalog/products/${p.id}`, { categoryId: foreignCategory.id })).statusCode).toBe(404);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).categoryId).toBe(c.id);
  });
});

describe("migração 20261117130000 (produto órfão → 'Sem categoria' oculta)", () => {
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("move órfãos para a categoria 'Sem categoria' como ocultos, sem tocar em quem já tem categoria", async () => {
    await resetDb();
    const store = await prisma.store.create({ data: { name: "L", slug: "loja-mig", code: "MG1" } });
    const other = await prisma.store.create({ data: { name: "L2", slug: "loja-mig2", code: "MG2" } });
    const kept = await prisma.category.create({ data: { storeId: store.id, name: "Lanches", position: 4 } });
    await prisma.product.create({ data: { storeId: store.id, categoryId: kept.id, name: "Com categoria", priceCents: 100, active: true } });
    await prisma.product.createMany({
      data: [
        { storeId: store.id, name: "Órfão 1", priceCents: 100, active: true },
        { storeId: store.id, name: "Órfão 2", priceCents: 100, active: true },
      ],
    });
    await prisma.product.create({ data: { storeId: other.id, categoryId: null, name: "Órfão de outra", priceCents: 100, active: true } });

    // roda o SQL da migração (idempotente para o que já foi tratado)
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(__dirname, "../../../packages/db/prisma/migrations/20261117130000_api56_categoria_obrigatoria/migration.sql"), "utf-8");
    for (const statement of sql.split(/;\s*\n/).map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);

    const orphans = await prisma.product.findMany({ where: { name: { startsWith: "Órfão" } }, include: { category: true } });
    expect(orphans.every((p) => p.categoryId !== null && p.active === false && p.category!.name === "Sem categoria")).toBe(true);
    expect(await prisma.category.count({ where: { name: "Sem categoria" } })).toBe(2); // uma por loja
    const semCategoria = await prisma.category.findFirstOrThrow({ where: { name: "Sem categoria", storeId: store.id } });
    expect(semCategoria.position).toBe(5); // no fim
    const intact = await prisma.product.findFirstOrThrow({ where: { name: "Com categoria" } });
    expect(intact).toMatchObject({ categoryId: kept.id, active: true });
    expect(await prisma.product.count({ where: { categoryId: null } })).toBe(0);
  });
});
