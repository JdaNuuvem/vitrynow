import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

// SEC-10 / SEC-11 (Sun Tzu, revisão 003): loja A não altera adicional de B nem injeta produto
// no cardápio de B usando ids públicos do menu.
describe("catálogo — isolamento entre lojas", () => {
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

  async function storeWithProduct(label: string) {
    const { cookie } = await registerStore(app, { slug: `loja-${label}`, code: label.toUpperCase(), email: `${label}@teste.com` });
    const headers = { cookie: cookie! };
    const cat = await app.inject({ method: "POST", url: "/api/catalog/categories", headers, payload: { name: `Cat ${label}`, position: 0 } });
    const categoryId = JSON.parse(cat.body).category.id as string;
    const prod = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers,
      payload: { categoryId, name: `Prod ${label}`, priceCents: 1000, additionals: [{ name: "Queijo", priceCents: 200 }] },
    });
    expect(prod.statusCode).toBe(201);
    const product = JSON.parse(prod.body).product;
    return { headers, categoryId, productId: product.id as string, additionalId: product.additionals[0].id as string, slug: `loja-${label}` };
  }

  const menu = async (slug: string) => JSON.parse((await app.inject({ method: "GET", url: `/stores/${slug}/menu` })).body);

  it("SEC-10: A não altera o adicional de B informando o id dele no próprio produto", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");

    const res = await app.inject({
      method: "POST",
      url: `/api/catalog/products/${a.productId}`,
      headers: a.headers,
      payload: { additionals: [{ id: b.additionalId, name: "HACKEADO", priceCents: 1 }] },
    });
    expect(res.statusCode).toBe(404);

    const stored = await prisma.productAdditional.findUniqueOrThrow({ where: { id: b.additionalId } });
    expect(stored.name).toBe("Queijo");
    expect(stored.priceCents).toBe(200);
    expect(stored.productId).toBe(b.productId);
  });

  it("SEC-10: falha atômica — nada do payload é aplicado quando um adicional é de outra loja", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    const res = await app.inject({
      method: "POST",
      url: `/api/catalog/products/${a.productId}`,
      headers: a.headers,
      payload: {
        name: "Renomeado",
        additionals: [
          { id: a.additionalId, name: "Mudou", priceCents: 999 },
          { id: b.additionalId, name: "HACKEADO", priceCents: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(404);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.productId } })).name).toBe("Prod a");
    expect((await prisma.productAdditional.findUniqueOrThrow({ where: { id: a.additionalId } })).name).toBe("Queijo");
  });

  it("SEC-10: o dono continua editando os próprios adicionais normalmente", async () => {
    const a = await storeWithProduct("a");
    const res = await app.inject({
      method: "POST",
      url: `/api/catalog/products/${a.productId}`,
      headers: a.headers,
      payload: { additionals: [{ id: a.additionalId, name: "Queijo extra", priceCents: 350 }, { name: "Bacon", priceCents: 400 }] },
    });
    expect(res.statusCode).toBe(200);
    const names = JSON.parse(res.body).product.additionals.map((x: { name: string }) => x.name).sort();
    expect(names).toEqual(["Bacon", "Queijo extra"]);
  });

  it("SEC-11: A não cria produto usando a categoria de B (não aparece no cardápio de B)", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    const res = await app.inject({
      method: "POST",
      url: "/api/catalog/products",
      headers: a.headers,
      payload: { categoryId: b.categoryId, name: "INJETADO", priceCents: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.product.count({ where: { name: "INJETADO" } })).toBe(0);
    const names = (await menu(b.slug)).categories.flatMap((c: { products: { name: string }[] }) => c.products.map((p) => p.name));
    expect(names).not.toContain("INJETADO");
  });

  it("SEC-11: A não move o próprio produto para a categoria de B", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    const res = await app.inject({ method: "POST", url: `/api/catalog/products/${a.productId}`, headers: a.headers, payload: { categoryId: b.categoryId } });
    expect(res.statusCode).toBe(404);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.productId } })).categoryId).toBe(a.categoryId);
  });

  it("SEC-11 + API-48 (defesa em profundidade): o BANCO recusa produto de A ligado à categoria de B (FK composta), e o menu de B segue só com o dele", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    // Antes da API-48 isto gravava o dado corrompido e o menu o filtrava; agora o banco nem deixa gravar.
    await expect(prisma.product.update({ where: { id: a.productId }, data: { categoryId: b.categoryId } })).rejects.toMatchObject({ code: "P2003" });
    const names = (await menu(b.slug)).categories.flatMap((c: { products: { name: string }[] }) => c.products.map((p) => p.name));
    expect(names).toEqual(["Prod b"]);
  });

  it("A tampouco edita/exclui produto e categoria de B (404, não 403: sem confirmar existência)", async () => {
    const a = await storeWithProduct("a");
    const b = await storeWithProduct("b");
    expect((await app.inject({ method: "POST", url: `/api/catalog/products/${b.productId}`, headers: a.headers, payload: { name: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/catalog/products/${b.productId}/delete`, headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/catalog/categories/${b.categoryId}`, headers: a.headers, payload: { name: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/catalog/categories/${b.categoryId}/delete`, headers: a.headers })).statusCode).toBe(404);
  });
});
