// PD-802000 (c1): SKU (código interno, único na loja, nunca público) e tags (lista fechada, selos do cardápio). Sem alérgenos (decisão do Claudio).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { PRODUCT_TAGS, productSkuSchema, productTagsSchema } from "@meucardapio/shared-types";
import { PUBLIC_PRODUCT_KEYS } from "../src/lib/publicDto";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("contrato do SKU e das tags", () => {
  it("SKU: aparado, em maiúsculas, 1 a 30 caracteres de letras/números/hífen/sublinhado; o resto é recusado", () => {
    expect(productSkuSchema.parse("  pf-01_a ")).toBe("PF-01_A");
    expect(productSkuSchema.safeParse("").success).toBe(false);
    expect(productSkuSchema.safeParse("A".repeat(31)).success).toBe(false);
    expect(productSkuSchema.safeParse("com espaço").success).toBe(false);
    expect(productSkuSchema.safeParse("açaí").success).toBe(false);
    expect(productSkuSchema.safeParse("=cmd").success).toBe(false); // nada que o Excel leia como fórmula
  });
  it("tags: só a lista fechada, sem repetidas; alérgeno não existe", () => {
    expect(productTagsSchema.parse(["VEGANO", "VEGANO", "FIT"])).toEqual(["VEGANO", "FIT"]);
    expect(productTagsSchema.safeParse(["GLUTEN"]).success).toBe(false);
    expect(productTagsSchema.safeParse(["LEITE"]).success).toBe(false);
    expect([...PRODUCT_TAGS]).toEqual(["VEGANO", "VEGETARIANO", "SEM_GLUTEN", "SEM_LACTOSE", "PICANTE", "FIT"]);
  });
});

describe("SKU e tags na API", { timeout: 90_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  const slug = "loja-sku";
  let categoryId: string;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    cookie = (await registerStore(app, { slug, code: "SK1" })).cookie!;
    categoryId = json(await post("/api/catalog/categories", { name: "Pratos" })).category.id;
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
  const criar = (extra: Record<string, unknown>, c = cookie, cat = categoryId) => post("/api/catalog/products", { categoryId: cat, name: "Prato", priceCents: 3000, ...extra }, c);

  it("SKU repetido na MESMA loja = 409 SKU_TAKEN (criar e editar, também com outra caixa); em OUTRA loja pode; vários sem SKU convivem; liberar com null", async () => {
    const a = await criar({ sku: "pf-01" });
    expect(a.statusCode, a.body).toBe(201);
    expect(json(a).product.sku).toBe("PF-01");
    const repetido = await criar({ sku: "PF-01", name: "Outro" });
    expect([repetido.statusCode, json(repetido).code]).toEqual([409, "SKU_TAKEN"]);
    const caixa = await criar({ sku: " pf-01 ", name: "Outro 2" });
    expect([caixa.statusCode, json(caixa).code]).toEqual([409, "SKU_TAKEN"]);
    expect(await prisma.product.count()).toBe(1); // nada gravado nas recusas
    const b = await criar({ name: "Sem código 1" });
    const c = await criar({ name: "Sem código 2" });
    expect([b.statusCode, c.statusCode]).toEqual([201, 201]);
    const editar = await post(`/api/catalog/products/${json(b).product.id}`, { sku: "PF-01" });
    expect([editar.statusCode, json(editar).code]).toEqual([409, "SKU_TAKEN"]);
    expect((await post(`/api/catalog/products/${json(b).product.id}`, { sku: "PF-02" })).statusCode).toBe(200);
    expect((await post(`/api/catalog/products/${json(a).product.id}`, { sku: null })).statusCode).toBe(200); // liberou o PF-01
    expect((await post(`/api/catalog/products/${json(c).product.id}`, { sku: "PF-01" })).statusCode).toBe(200);
    const outra = await registerStore(app, { slug: "loja-sku-b", code: "SK2" });
    const catB = json(await post("/api/catalog/categories", { name: "Pratos" }, outra.cookie!)).category.id;
    expect((await criar({ sku: "PF-01" }, outra.cookie!, catB)).statusCode).toBe(201); // outra loja, mesmo código
  });

  it("SKU simultâneo: duas gravações do mesmo código na mesma loja, uma vence e a outra é 409 (a chave única decide)", async () => {
    const resultados = await Promise.all([criar({ sku: "CORRIDA", name: "A" }), criar({ sku: "CORRIDA", name: "B" }), criar({ sku: "CORRIDA", name: "C" })]);
    expect(resultados.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    expect(await prisma.product.count({ where: { sku: "CORRIDA" } })).toBe(1);
  });

  it("SKU inválido = 400 e nada gravado; tags inválidas = 400; tags repetidas viram uma", async () => {
    expect((await criar({ sku: "com espaço" })).statusCode).toBe(400);
    expect((await criar({ tags: ["GLUTEN"] })).statusCode).toBe(400);
    expect(await prisma.product.count()).toBe(0);
    const ok = await criar({ tags: ["VEGANO", "PICANTE", "VEGANO"] });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(json(ok).product.tags).toEqual(["VEGANO", "PICANTE"]);
  });

  it("DTO público: tags aparecem; sku NUNCA (nem a coluna); chaves exatas continuam; produto antigo vem com tags vazias", async () => {
    await criar({ sku: "SEGREDO-1", tags: ["VEGANO", "SEM_GLUTEN"], name: "Com selos" });
    await criar({ name: "Antigo" });
    const corpo = await app.inject({ method: "GET", url: `/stores/${slug}/menu` });
    const produtos = json(corpo).categories.flatMap((c: { products: Array<Record<string, unknown>> }) => c.products);
    for (const p of produtos) expect(Object.keys(p).sort()).toEqual([...PUBLIC_PRODUCT_KEYS].sort());
    expect(produtos.find((p: Record<string, unknown>) => p.name === "Com selos")).toMatchObject({ tags: ["VEGANO", "SEM_GLUTEN"] });
    expect(produtos.find((p: Record<string, unknown>) => p.name === "Antigo")).toMatchObject({ tags: [] });
    expect(corpo.body).not.toContain("SEGREDO-1");
    expect(corpo.body).not.toContain('"sku"');
  });

  it("isolamento: STAFF/dono de outra loja nunca altera SKU ou tags de produto alheio (404) e o código dela não é afetado", async () => {
    const a = await criar({ sku: "A-1" });
    const b = await registerStore(app, { slug: "loja-sku-c", code: "SK3" });
    const invasor = await post(`/api/catalog/products/${json(a).product.id}`, { sku: "HACK", tags: ["FIT"] }, b.cookie!);
    expect(invasor.statusCode).toBe(404);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: json(a).product.id } })).toMatchObject({ sku: "A-1", tags: [] });
  });
});
