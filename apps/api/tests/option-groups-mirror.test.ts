// API-15 parte 3 (RN-B8-08, CA-B8-06): editar adicionais pelo painel antigo mantem o grupo LEGACY_ADDITIONALS espelhado (mesmo id na opcao).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("espelho dos adicionais no grupo LEGACY_ADDITIONALS", { timeout: 60_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C", icon: "x" } })).category.id;
    return { cookie: cookie!, storeId, cat };
  }
  const mirror = (productId: string) => prisma.option.findMany({ where: { groupId: `og_leg_${productId}` }, orderBy: { name: "asc" } });

  it("criar, editar, remover e esvaziar adicionais atualiza o espelho (mesmos ids e precos)", async () => {
    const l = await setup();
    const created = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: l.cookie }, payload: { categoryId: l.cat, name: "P", priceCents: 1000, additionals: [{ name: "A", priceCents: 100 }, { name: "B", priceCents: 200 }] } })).product;
    const ids = created.additionals.map((a: { id: string }) => a.id).sort();
    expect((await mirror(created.id)).map((o) => o.id).sort()).toEqual(ids);
    expect(await prisma.productOptionGroup.count({ where: { productId: created.id, groupId: `og_leg_${created.id}` } })).toBe(1);

    const a = created.additionals.find((x: { name: string }) => x.name === "A");
    const upd = await app.inject({ method: "POST", url: `/api/catalog/products/${created.id}`, headers: { cookie: l.cookie }, payload: { additionals: [{ id: a.id, name: "A2", priceCents: 150 }, { name: "C", priceCents: 300 }] } });
    expect(upd.statusCode, upd.body).toBe(200);
    const after = await mirror(created.id);
    expect(after.map((o) => [o.name, o.priceCents])).toEqual([["A2", 150], ["C", 300]]);
    expect(after.find((o) => o.name === "A2")!.id).toBe(a.id);

    await app.inject({ method: "POST", url: `/api/catalog/products/${created.id}`, headers: { cookie: l.cookie }, payload: { additionals: [] } });
    expect(await prisma.optionGroup.count({ where: { id: `og_leg_${created.id}` } })).toBe(0);
    expect(await prisma.option.count({ where: { groupId: `og_leg_${created.id}` } })).toBe(0);
  });
});
