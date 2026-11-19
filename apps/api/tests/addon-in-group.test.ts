// c4 do produto detalhado (carimbo 803000, RN-PD-12/13/15): adicional ligado a grupo de opções, ADDON_IN_USE, isolamento entre lojas.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaCatalogRepository } from "../src/modules/catalog/catalog.repository";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("adicional como opção de grupo (c4)", { timeout: 120_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  const slug = "loja-c4";
  let storeId: string;
  let categoryId: string;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    const r = await registerStore(app, { slug, code: "C41", pix: false });
    cookie = r.cookie!;
    storeId = json(r.response).store.id;
    categoryId = json(await post("/api/catalog/categories", { name: "Pratos" })).category.id;
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function post(url: string, payload?: unknown, as?: string) {
    return app.inject({ method: "POST", url, headers: { cookie: as ?? cookie }, payload: payload as never });
  }
  const produto = async (body: Record<string, unknown>, as?: string, category = categoryId) =>
    json(await post("/api/catalog/products", { categoryId: category, priceCents: 1000, ...body }, as)).product.id as string;
  const grupo = (options: unknown[], extra: Record<string, unknown> = {}, as?: string) =>
    post("/api/catalog/option-groups", { name: "Extras", minSelect: 0, maxSelect: 2, maxPerOption: 1, priceMode: "SUM", options, ...extra }, as);
  const pedido = (items: unknown[]) => app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items } });
  type MenuProduct = { id: string; unavailable?: boolean; optionGroups: Array<{ options: Array<{ id: string; name: string; priceCents: number }> }> };
  const menuProduct = async (id: string) =>
    (json(await app.inject({ method: "GET", url: `/stores/${slug}/menu` })).categories as Array<{ products: MenuProduct[] }>).flatMap((c) => c.products).find((p) => p.id === id);

  async function montar() {
    const ovo = await produto({ kind: "ADICIONAL", name: "Ovo", priceCents: 300 });
    const prato = await produto({ name: "Prato", priceCents: 2000 });
    const g = await grupo([{ name: "x", priceCents: 0, productId: ovo }]);
    expect(g.statusCode).toBe(201);
    const group = json(g).group as { id: string; options: Array<{ id: string }> };
    expect((await post(`/api/catalog/products/${prato}/option-groups`, { groupIds: [group.id] })).statusCode).toBe(200);
    return { ovo, prato, group, optionId: group.options[0].id };
  }

  it("INHERIT (padrão): nome e preço vêm do adicional e o pedido grava o preço do momento; mudar o adicional muda a vitrine, não o pedido antigo", async () => {
    const { ovo, prato, optionId } = await montar();
    const opt = (await menuProduct(prato))!.optionGroups[0].options[0];
    expect(opt).toMatchObject({ id: optionId, name: "Ovo", priceCents: 300 });
    const r = await pedido([{ productId: prato, quantity: 1, options: [{ optionId }] }]);
    expect(r.statusCode).toBe(201);
    expect((await prisma.orderItemOption.findFirstOrThrow()).priceCents).toBe(300);
    await post(`/api/catalog/products/${ovo}`, { priceCents: 450 });
    expect((await menuProduct(prato))!.optionGroups[0].options[0].priceCents).toBe(450);
    expect((await prisma.orderItemOption.findFirstOrThrow()).priceCents).toBe(300); // pedido antigo nunca muda
  });

  it("OWN: preço próprio só naquele grupo", async () => {
    const ovo = await produto({ kind: "ADICIONAL", name: "Ovo", priceCents: 300 });
    const prato = await produto({ name: "Prato" });
    const g = json(await grupo([{ name: "Ovo", priceCents: 150, productId: ovo, priceSource: "OWN" }])).group;
    await post(`/api/catalog/products/${prato}/option-groups`, { groupIds: [g.id] });
    expect((await menuProduct(prato))!.optionGroups[0].options[0].priceCents).toBe(150);
  });

  it("esgotar ou inativar o adicional o tira do grupo; grupo obrigatório sem opção deixa o prato indisponível e o pedido é recusado", async () => {
    const { ovo, prato, group } = await montar();
    await post(`/api/catalog/option-groups/${group.id}`, { name: "Extras", minSelect: 1, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", options: [{ id: group.options[0].id, name: "x", priceCents: 0, productId: ovo }] });
    await prisma.product.update({ where: { id: ovo }, data: { soldOut: true } });
    const p = (await menuProduct(prato))!;
    expect(p.optionGroups[0].options).toHaveLength(0);
    expect(p.unavailable).toBe(true);
    const r = await pedido([{ productId: prato, quantity: 1, options: [{ optionId: group.options[0].id }] }]);
    expect(r.statusCode).toBe(400);
    await prisma.product.update({ where: { id: ovo }, data: { soldOut: false, active: false } });
    expect((await menuProduct(prato))!.optionGroups[0].options).toHaveLength(0);
  });

  it("só produto ADICIONAL da MESMA loja: PRATO => 400; outra loja ou inexistente => 404 igual; nada gravado; o banco também recusa", async () => {
    const outra = await registerStore(app, { slug: "outra-c4", code: "C42", pix: false });
    const cat2 = json(await post("/api/catalog/categories", { name: "X" }, outra.cookie!)).category.id;
    const ovoOutra = await produto({ kind: "ADICIONAL", name: "Ovo" }, outra.cookie!, cat2);
    const prato = await produto({ name: "Prato" });
    const r1 = await grupo([{ name: "x", priceCents: 0, productId: prato }]);
    expect([r1.statusCode, json(r1).code]).toEqual([400, "OPTION_PRODUCT_NOT_ADDON"]);
    const r2 = await grupo([{ name: "x", priceCents: 0, productId: ovoOutra }]);
    const r3 = await grupo([{ name: "x", priceCents: 0, productId: "nao-existe" }]);
    expect([r2.statusCode, r3.statusCode]).toEqual([404, 404]);
    expect(r2.body).toBe(r3.body);
    expect(await prisma.optionGroup.count({ where: { storeId } })).toBe(0);
    const ok = json(await grupo([{ name: "ok", priceCents: 0 }])).group as { id: string };
    await expect(prisma.option.create({ data: { storeId, groupId: ok.id, name: "x", priceCents: 0, productId: ovoOutra } })).rejects.toThrow();
  });

  it("ADDON_IN_USE: excluir adicional em uso => 409 com onde é usado; deixar de ser adicional também; depois de tirar do grupo exclui", async () => {
    const { ovo, group } = await montar();
    const del = await post(`/api/catalog/products/${ovo}/delete`);
    expect([del.statusCode, json(del).code]).toEqual([409, "ADDON_IN_USE"]);
    expect(JSON.stringify(json(del))).toContain(group.id);
    expect(await prisma.product.count({ where: { id: ovo } })).toBe(1);
    const kind = await post(`/api/catalog/products/${ovo}`, { kind: "PRATO" });
    expect([kind.statusCode, json(kind).code]).toEqual([409, "ADDON_IN_USE"]);
    await post(`/api/catalog/option-groups/${group.id}`, { name: "Extras", minSelect: 0, maxSelect: 2, maxPerOption: 1, priceMode: "SUM", options: [] });
    expect((await post(`/api/catalog/products/${ovo}/delete`)).statusCode).toBe(200);
  });

  it("grupo BASE não aceita adicional", async () => {
    const ovo = await produto({ kind: "ADICIONAL", name: "Ovo" });
    const r = await grupo([{ name: "x", priceCents: 0, productId: ovo }], { priceMode: "BASE", minSelect: 1, maxSelect: 1 });
    expect([r.statusCode, json(r).code]).toEqual([400, "OPTION_ADDON_IN_BASE_GROUP"]);
  });

  it("corrida: se a conferência não viu o uso, a FK recusa e a rota responde 409 ADDON_IN_USE (nunca 500)", async () => {
    const { ovo } = await montar();
    const spy = vi.spyOn(PrismaCatalogRepository.prototype, "addonUsage").mockResolvedValue({ groups: [], products: 0 });
    try {
      const del = await post(`/api/catalog/products/${ovo}/delete`);
      expect([del.statusCode, json(del).code]).toEqual([409, "ADDON_IN_USE"]);
      expect(await prisma.product.count({ where: { id: ovo } })).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
