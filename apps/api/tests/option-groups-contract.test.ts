// Contrato das opções com o front do sócio: `optionSelections` é ALIAS de `options`; `expectedUnitPriceCents` só gera 409 (compara com o TOTAL por unidade, nunca vira preço);
// tetos de seleções (R1); cardápio público com `unavailableByOptions` e `fromPriceCents`. Vale para vitrine, mesa e pedido manual (um só caminho: lib/orderItems.ts).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("contrato das opções (alias, preço esperado, tetos)", { timeout: 90_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  const slug = "loja-contrato-opc";
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    cookie = (await registerStore(app, { slug, code: "CO1" })).cookie!;
  });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await resetDb(); await prisma.$disconnect(); });
  const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as never });

  async function montar() {
    const cat = json(await post("/api/catalog/categories", { name: "Pizzas" })).category.id as string;
    const prod = json(await post("/api/catalog/products", { categoryId: cat, name: "Pizza", priceCents: 5000, additionals: [{ name: "Ovo", priceCents: 300 }] })).product;
    const tam = json(await post("/api/catalog/option-groups", { name: "Tamanho", minSelect: 1, maxSelect: 1, maxPerOption: 1, priceMode: "BASE", options: [{ name: "P", priceCents: 3000 }, { name: "G", priceCents: 6000 }] })).group;
    const borda = json(await post("/api/catalog/option-groups", { name: "Borda", minSelect: 0, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", options: [{ name: "Catupiry", priceCents: 800 }] })).group;
    await post(`/api/catalog/products/${prod.id}/option-groups`, { groupIds: [tam.id, borda.id] });
    return { prod: prod.id as string, G: tam.options.find((o: { name: string }) => o.name === "G").id as string, catupiry: borda.options[0].id as string, ovo: prod.additionals[0].id as string };
  }
  const order = (items: unknown[]) => app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", items } });
  const total = async () => (await prisma.order.findFirstOrThrow({ where: { store: { slug } } })).totalCents;

  it("optionSelections vale como options (mesmo preço e cópia); os dois juntos = 400", async () => {
    const { prod, G, catupiry } = await montar();
    const res = await order([{ productId: prod, quantity: 3, optionSelections: [{ optionId: G, quantity: 1 }, { optionId: catupiry, quantity: 1 }] }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(await total()).toBe(20400);
    expect(await prisma.orderItemOption.count()).toBe(2);
    const dupla = await order([{ productId: prod, quantity: 1, options: [{ optionId: G }], optionSelections: [{ optionId: G, quantity: 1 }] }]);
    expect(dupla.statusCode).toBe(400);
    expect(json(dupla).code).toBe("OPTIONS_AMBIGUOUS");
  });

  it("expectedUnitPriceCents: certo = 201 (opções e adicional legado); errado = 409 e NADA gravado; nunca altera o preço cobrado", async () => {
    const { prod, G, catupiry } = await montar();
    const cat2 = json(await post("/api/catalog/categories", { name: "Outros" })).category.id as string;
    const simples = json(await post("/api/catalog/products", { categoryId: cat2, name: "Suco", priceCents: 1000, additionals: [{ name: "Gelo", priceCents: 200 }] })).product;
    const certoOpcoes = await order([{ productId: prod, quantity: 2, options: [{ optionId: G }, { optionId: catupiry }], expectedUnitPriceCents: 6800 }]);
    expect(certoOpcoes.statusCode, certoOpcoes.body).toBe(201);
    const certoLegado = await order([{ productId: simples.id, quantity: 1, additionalIds: [simples.additionals[0].id], expectedUnitPriceCents: 1200 }]); // total por unidade, não o campo gravado (1000)
    expect(certoLegado.statusCode, certoLegado.body).toBe(201);
    const antes = await prisma.order.count();
    const errado = await order([{ productId: prod, quantity: 1, options: [{ optionId: G }, { optionId: catupiry }], expectedUnitPriceCents: 6000 }]);
    expect(errado.statusCode).toBe(409);
    expect(json(errado).code).toBe("ITEM_PRICE_CHANGED");
    expect(json(errado).details.items[0]).toMatchObject({ productId: prod, unitPriceCents: 6800 });
    const erradoLegado = await order([{ productId: simples.id, quantity: 1, additionalIds: [simples.additionals[0].id], expectedUnitPriceCents: 1000 }]);
    expect(erradoLegado.statusCode).toBe(409);
    expect(await prisma.order.count()).toBe(antes);
    const orders = await prisma.order.findMany({ where: { store: { slug } }, orderBy: { createdAt: "asc" } });
    expect(orders.map((o) => o.totalCents)).toEqual([13600, 1200]); // o esperado nunca vira preço
  });

  it("tetos: mais de 30 seleções por item ou 200 por pedido = 400 OPTIONS_TOO_MANY, sem gravar", async () => {
    const { prod, G } = await montar();
    const muitas = (n: number) => Array.from({ length: n }, () => ({ optionId: G, quantity: 1 }));
    const item = await order([{ productId: prod, quantity: 1, optionSelections: muitas(31) }]);
    expect(item.statusCode).toBe(400);
    expect(json(item).code).toBe("OPTIONS_TOO_MANY");
    const pedido = await order(Array.from({ length: 8 }, () => ({ productId: prod, quantity: 1, optionSelections: muitas(26) })));
    expect(pedido.statusCode).toBe(400);
    expect(json(pedido).code).toBe("OPTIONS_TOO_MANY");
    expect(await prisma.order.count()).toBe(0);
  });

  it("cardápio público: unavailableByOptions (= unavailable) e fromPriceCents ('a partir de'); mesa e painel usam o mesmo caminho", async () => {
    const { prod, G } = await montar();
    const produto = () => app.inject({ method: "GET", url: `/stores/${slug}/menu` }).then((r) => json(r).categories[0].products[0]);
    expect(await produto()).toMatchObject({ unavailable: false, unavailableByOptions: false, fromPriceCents: 3000 });
    await prisma.option.updateMany({ data: { active: false }, where: { group: { name: "Tamanho" } } });
    expect(await produto()).toMatchObject({ unavailable: true, unavailableByOptions: true, fromPriceCents: null });
    void prod; void G;
  });
});
