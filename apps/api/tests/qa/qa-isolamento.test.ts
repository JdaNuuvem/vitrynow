// QA-13 — isolamento entre lojas no catálogo e na listagem de chaves (achados ST-10, ST-11, ST-12 da Sun Tzu).
// Cada teste afirma o comportamento CORRETO ("a loja A não altera nem injeta nada na loja B").
//
// Convenção (igual a qa-probes): bug(...) = it.fails enquanto o bug existe; quando o fix entrar a suíte
// fica vermelha e quem corrigiu troca bug(...) por it(...). Modo estrito para verificar um fix SEM editar:
//   QA_STRICT=1 pnpm --filter @meucardapio/api exec vitest run tests/qa/qa-isolamento.test.ts
// (no modo estrito os testes rodam como it normal: têm de PASSAR na branch com o fix e FALHAR em main).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

const bug = process.env.QA_STRICT ? it : it.fails;

describe("QA isolamento entre lojas", () => {
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

  async function storeWithProduct(n: string) {
    const { cookie, response } = await registerStore(app, { slug: `loja-${n}`, code: `L${n}`, email: `dono-${n}@teste.com` });
    const store = JSON.parse(response.body).store as { id: string; slug: string };
    const cat = JSON.parse(
      (await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: `Cat ${n}` } })).body,
    ).category.id as string;
    const product = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/catalog/products",
          headers: { cookie: cookie! },
          payload: { categoryId: cat, name: `Produto ${n}`, priceCents: 1500, additionals: [{ name: `Extra ${n}`, priceCents: 300 }] },
        })
      ).body,
    ).product as { id: string; additionals: { id: string }[] };
    return { cookie: cookie!, store, categoryId: cat, productId: product.id, additionalId: product.additionals[0].id };
  }

  bug("D25 (ST-10) loja A não consegue alterar adicional da loja B enviando o id dele na edição de produto", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    await app.inject({
      method: "POST",
      url: `/api/catalog/products/${a.productId}`,
      headers: { cookie: a.cookie },
      payload: { additionals: [{ id: b.additionalId, name: "HACK", priceCents: 0 }] },
    });
    const victim = await prisma.productAdditional.findUnique({ where: { id: b.additionalId } });
    expect({ name: victim?.name, priceCents: victim?.priceCents, productId: victim?.productId }).toEqual({
      name: "Extra b",
      priceCents: 300,
      productId: b.productId,
    });
  });

  it("D25b (ST-10) o adicional de B também não é 'roubado' para o produto de A", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    await app.inject({
      method: "POST",
      url: `/api/catalog/products/${a.productId}`,
      headers: { cookie: a.cookie },
      payload: { additionals: [{ id: b.additionalId, name: "Extra b", priceCents: 300 }] },
    });
    const victim = await prisma.productAdditional.findUnique({ where: { id: b.additionalId } });
    expect(victim?.productId).toBe(b.productId);
  });

  bug("D26 (ST-11) criar produto em categoria de OUTRA loja é recusado e nada é criado", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    const res = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: { cookie: a.cookie },
      payload: { categoryId: b.categoryId, name: "Injetado pela loja A", priceCents: 1 },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await prisma.product.count({ where: { storeId: a.store.id, categoryId: b.categoryId } })).toBe(0);
    const menuB = JSON.parse((await app.inject({ method: "GET", url: `/stores/${b.store.slug}/menu` })).body);
    const names = menuB.categories.flatMap((c: { products: { name: string }[] }) => c.products.map((p) => p.name));
    expect(names).not.toContain("Injetado pela loja A");
  });

  bug("D26b (ST-11) mover produto de A para categoria de B pela edição é recusado", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    const res = await app.inject({
      method: "POST",
      url: `/api/catalog/products/${a.productId}`,
      headers: { cookie: a.cookie },
      payload: { categoryId: b.categoryId },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect((await prisma.product.findUnique({ where: { id: a.productId } }))?.categoryId).toBe(a.categoryId);
  });

  bug("D26c (ST-11, defesa em profundidade) o cardápio público de B nunca lista produto de outra loja, mesmo com dado inconsistente no banco", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    // Simula dado ruim já gravado (a API de catálogo antiga aceitava isso): produto da loja A dentro da categoria de B.
    await prisma.product.create({ data: { storeId: a.store.id, categoryId: b.categoryId, name: "Produto fantasma de A", priceCents: 100 } });
    const menuB = JSON.parse((await app.inject({ method: "GET", url: `/stores/${b.store.slug}/menu` })).body);
    const names = menuB.categories.flatMap((c: { products: { name: string }[] }) => c.products.map((p) => p.name));
    expect(names).not.toContain("Produto fantasma de A");
    expect(names).toContain("Produto b");
  });

  bug("D26d (ST-11) excluir a categoria de B não é bloqueado por produto de outra loja", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    await prisma.product.create({ data: { storeId: a.store.id, categoryId: b.categoryId, name: "Produto fantasma de A", priceCents: 100 } });
    await prisma.product.delete({ where: { id: b.productId } });
    const del = await app.inject({ method: "POST", url: `/api/catalog/categories/${b.categoryId}/delete`, headers: { cookie: b.cookie } });
    expect(del.statusCode).toBe(200);
  });

  async function inviteStaff(owner: { cookie: string }, email: string) {
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner.cookie }, payload: { email, password: "senha123" } });
    expect(invite.statusCode).toBe(201);
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "senha123" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  }

  bug("D27 (ST-12) STAFF não consegue listar as chaves de impressora", async () => {
    const owner = await storeWithProduct("a");
    await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: owner.cookie }, payload: { label: "balcão" } });
    const staffCookie = await inviteStaff(owner, "staff-a@teste.com");
    const res = await app.inject({ method: "GET", url: "/api/device-tokens", headers: { cookie: staffCookie } });
    expect(res.statusCode).toBe(403);
  });

  bug("D27b (ST-12/NG-06) a listagem de chaves nunca devolve o token em texto (só quando é criado)", async () => {
    const owner = await storeWithProduct("a");
    const created = JSON.parse((await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: owner.cookie }, payload: { label: "balcão" } })).body);
    const full = created.token.token as string;
    expect(typeof full).toBe("string");
    const listing = (await app.inject({ method: "GET", url: "/api/device-tokens", headers: { cookie: owner.cookie } })).body;
    expect(listing).not.toContain(full);
  });
});
