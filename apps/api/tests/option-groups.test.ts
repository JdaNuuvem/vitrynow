import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { activateSubscription } from "../src/lib/subscription";
import { buildPrintableOrder } from "../src/lib/printable";
import { optionGroupsService } from "../src/modules/optionGroups/optionGroups.module";
import { resolveLine } from "../src/modules/optionGroups/optionGroups.domain";
import { login, makeApp, registerStore, resetDb } from "./helpers";

// API-15 (B8): CRUD de grupos, vínculo com produtos, isolamento entre lojas e migração dos adicionais (CA-B8-06).

describe("grupos de opções (API-15)", () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  let storeId: string;
  let categoryId: string;

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    const registered = await registerStore(app, { slug: "loja-opc", code: "OP1" });
    cookie = registered.cookie!;
    storeId = JSON.parse(registered.response.body).store.id;
    categoryId = JSON.parse((await post("/api/catalog/categories", { name: "Pizzas" })).body).category.id;
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  function post(url: string, payload?: unknown, as?: string) {
    return app.inject({ method: "POST", url, headers: { cookie: as ?? cookie }, payload: payload as never });
  }
  const get = (url: string, as?: string) => app.inject({ method: "GET", url, headers: { cookie: as ?? cookie } });

  const tamanhoInput = {
    name: "Tamanho",
    minSelect: 1,
    maxSelect: 1,
    maxPerOption: 1,
    priceMode: "BASE",
    options: [
      { name: "P", priceCents: 3000 },
      { name: "M", priceCents: 4500 },
      { name: "G", priceCents: 6000 },
    ],
  };
  const bordaInput = { name: "Borda", minSelect: 0, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", options: [{ name: "Catupiry", priceCents: 800 }] };
  const createGroup = async (input: unknown, as?: string) => {
    const response = await post("/api/catalog/option-groups", input, as);
    if (response.statusCode !== 201) throw new Error(`criar grupo falhou: ${response.statusCode} ${response.body}`);
    return json(response).group as { id: string; options: Array<{ id: string; name: string }> };
  };
  const createProduct = async (name = "Pizza", as?: string, category = categoryId) =>
    json(await post("/api/catalog/products", { categoryId: category, name, priceCents: 5000 }, as)).product.id as string;

  async function staffCookie() {
    await activateSubscription({ subscriptionId: (await prisma.subscription.findFirstOrThrow()).id, planCode: "PRO" });
    expect((await post("/api/users", { email: "staff-op@teste.com", password: "senha-forte-123" })).statusCode).toBe(201);
    return (await login(app, "staff-op@teste.com", "senha-forte-123")).cookie!;
  }

  it("cria grupo com opções em ordem, lista com contagem de produtos e devolve avisos sem bloquear", async () => {
    const created = await post("/api/catalog/option-groups", { ...bordaInput, minSelect: 2, maxSelect: 2 }); // mín. 2 com 1 opção ativa: AVISO
    expect(created.statusCode).toBe(201);
    expect(json(created).warnings.map((w: { code: string }) => w.code)).toEqual(["MIN_ABOVE_ACTIVE_OPTIONS"]);

    const tamanho = await createGroup(tamanhoInput);
    expect(tamanho.options.map((o) => o.name)).toEqual(["P", "M", "G"]);
    const productId = await createProduct();
    await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [tamanho.id] });

    const listed = json(await get("/api/catalog/option-groups")).groups as Array<{ name: string; productCount: number }>;
    expect(listed.map((g) => [g.name, g.productCount])).toEqual([["Borda", 0], ["Tamanho", 1]]);
  });

  it("configuração impossível é 400 OPTION_GROUP_INVALID e nada é gravado (máximo < mínimo; BASE ≠ 1..1; > 30 opções)", async () => {
    for (const bad of [
      { ...bordaInput, minSelect: 3, maxSelect: 2 },
      { ...tamanhoInput, minSelect: 0 },
      { ...bordaInput, options: Array.from({ length: 31 }, (_, i) => ({ name: `O${i}`, priceCents: 1 })) },
    ]) {
      const r = await post("/api/catalog/option-groups", bad);
      expect(r.statusCode).toBe(400);
      expect(json(r).code).toBe("OPTION_GROUP_INVALID");
    }
    expect(await prisma.optionGroup.count()).toBe(0);
    expect((await post("/api/catalog/option-groups", { name: "", options: [] })).statusCode).toBe(400);
    expect((await post("/api/catalog/option-groups", { ...bordaInput, options: [{ name: "A", priceCents: -5 }] })).statusCode).toBe(400);
  });

  it("editar: reconcilia opções por id (atualiza, cria, remove); opção de OUTRO grupo ou loja é 404 e nada muda (SEC-10)", async () => {
    const group = await createGroup({ ...bordaInput, options: [{ name: "A", priceCents: 100 }, { name: "B", priceCents: 200 }] });
    const [a] = group.options;
    const updated = await post(`/api/catalog/option-groups/${group.id}`, { ...bordaInput, name: "Borda nova", options: [{ id: a.id, name: "A2", priceCents: 150 }, { name: "C", priceCents: 300, active: false }] });
    expect(updated.statusCode).toBe(200);
    const options = (await prisma.option.findMany({ where: { groupId: group.id }, orderBy: { position: "asc" } })).map((o) => [o.name, o.priceCents, o.active]);
    expect(options).toEqual([["A2", 150, true], ["C", 300, false]]);
    expect(json(updated).group.options.find((o: { id: string }) => o.id === a.id)).toBeTruthy(); // a opção A manteve o id

    const other = await registerStore(app, { slug: "outra-opc", code: "OP2" });
    const foreignGroup = await createGroup(bordaInput, other.cookie!);
    const before = await prisma.option.findMany({ where: { groupId: foreignGroup.id } });
    const attack = await post(`/api/catalog/option-groups/${group.id}`, { ...bordaInput, options: [{ id: before[0].id, name: "HACK", priceCents: 1 }] });
    expect(attack.statusCode).toBe(404);
    expect(await prisma.option.findUniqueOrThrow({ where: { id: before[0].id } })).toMatchObject({ name: "Catupiry", priceCents: 800 });
    // a transação desfez: as opções do grupo continuam as de antes do ataque
    expect((await prisma.option.findMany({ where: { groupId: group.id } })).map((o) => o.name).sort()).toEqual(["A2", "C"]);
  });

  it("grupo de outra loja: editar/excluir/vincular é 404", async () => {
    const other = await registerStore(app, { slug: "outra-opc", code: "OP2" });
    const foreignGroup = await createGroup(bordaInput, other.cookie!);
    const productId = await createProduct();
    expect((await post(`/api/catalog/option-groups/${foreignGroup.id}`, bordaInput)).statusCode).toBe(404);
    expect((await post(`/api/catalog/option-groups/${foreignGroup.id}/delete`)).statusCode).toBe(404);
    expect((await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [foreignGroup.id] })).statusCode).toBe(404);
    expect(await prisma.productOptionGroup.count()).toBe(0);
    expect(await prisma.optionGroup.count({ where: { storeId } })).toBe(0);
  });

  it("o banco recusa vínculo entre lojas mesmo que a API esqueça o filtro (FK composta, ADR-0009)", async () => {
    const other = await registerStore(app, { slug: "outra-opc", code: "OP2" });
    const foreignGroup = await createGroup(bordaInput, other.cookie!);
    const productId = await createProduct();
    await expect(prisma.productOptionGroup.create({ data: { productId, groupId: foreignGroup.id, storeId } })).rejects.toThrow();
    const otherStore = JSON.parse((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: other.cookie! } })).body).user.storeId;
    await expect(prisma.productOptionGroup.create({ data: { productId, groupId: foreignGroup.id, storeId: otherStore } })).rejects.toThrow();
    await expect(prisma.option.create({ data: { storeId, groupId: foreignGroup.id, name: "Intruso", priceCents: 1 } })).rejects.toThrow();
  });

  it("vincular: ordem preservada, substitui os anteriores; dois grupos BASE e mais de 10 grupos são recusados", async () => {
    const tamanho = await createGroup(tamanhoInput);
    const massa = await createGroup({ ...tamanhoInput, name: "Massa" });
    const borda = await createGroup(bordaInput);
    const productId = await createProduct();

    const two = await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [tamanho.id, massa.id] });
    expect(two.statusCode).toBe(400);
    expect(json(two).code).toBe("TWO_BASE_GROUPS");

    const ok = await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [borda.id, tamanho.id] });
    expect(ok.statusCode).toBe(200);
    expect(json(ok).groups.map((g: { name: string }) => g.name)).toEqual(["Borda", "Tamanho"]);
    expect(json(ok).fromPriceCents).toBe(3000);
    expect(json(ok).unavailableBecause).toEqual([]);

    const replaced = await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [tamanho.id] });
    expect(json(replaced).groups.map((g: { name: string }) => g.name)).toEqual(["Tamanho"]);
    expect((await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [tamanho.id, tamanho.id] })).statusCode).toBe(400);

    const many = [];
    for (let i = 0; i < 11; i++) many.push((await createGroup({ ...bordaInput, name: `G${i}` })).id);
    const tooMany = await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: many });
    expect(json(tooMany).code).toBe("TOO_MANY_GROUPS");
  });

  it("virar BASE um grupo que já divide produto com outro BASE é 409 TWO_BASE_GROUPS", async () => {
    const tamanho = await createGroup(tamanhoInput);
    const borda = await createGroup(bordaInput);
    const productId = await createProduct("Pizza");
    await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [tamanho.id, borda.id] });
    const r = await post(`/api/catalog/option-groups/${borda.id}`, { ...tamanhoInput, name: "Borda" });
    expect(r.statusCode).toBe(409);
    expect(json(r)).toMatchObject({ code: "TWO_BASE_GROUPS", products: ["Pizza"] });
  });

  it("produto fica indisponível por regra quando o grupo obrigatório fica sem opção ativa (RN-B8-05)", async () => {
    const tamanho = await createGroup(tamanhoInput);
    const productId = await createProduct();
    await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [tamanho.id] });
    await prisma.option.updateMany({ where: { groupId: tamanho.id }, data: { active: false } });
    const r = json(await get(`/api/catalog/products/${productId}/option-groups`));
    expect(r.unavailableBecause).toEqual([{ groupId: tamanho.id, name: "Tamanho" }]);
    expect(r.fromPriceCents).toBeNull();
  });

  it("excluir grupo: só OWNER (STAFF 403 FORBIDDEN_ROLE), informa 'usado em N produtos' e solta os vínculos (RN-B8-14)", async () => {
    const group = await createGroup(bordaInput);
    const p1 = await createProduct("A");
    const p2 = await createProduct("B");
    for (const p of [p1, p2]) await post(`/api/catalog/products/${p}/option-groups`, { groupIds: [group.id] });

    const staff = await staffCookie();
    const denied = await post(`/api/catalog/option-groups/${group.id}/delete`, undefined, staff);
    expect(denied.statusCode).toBe(403);
    expect(json(denied).code).toBe("FORBIDDEN_ROLE");
    expect((await post(`/api/catalog/option-groups/${group.id}`, { ...bordaInput, name: "Borda do staff" }, staff)).statusCode).toBe(200); // STAFF edita

    const deleted = await post(`/api/catalog/option-groups/${group.id}/delete`);
    expect(json(deleted)).toEqual({ ok: true, usedIn: 2 });
    expect(await prisma.productOptionGroup.count()).toBe(0);
    expect(await prisma.option.count()).toBe(0);
    expect(await prisma.product.count()).toBe(2); // os produtos ficam
  });

  it("excluir produto leva os vínculos, não o grupo (que é reutilizável)", async () => {
    const group = await createGroup(bordaInput);
    const productId = await createProduct();
    await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [group.id] });
    expect((await post(`/api/catalog/products/${productId}/delete`)).statusCode).toBe(200);
    expect(await prisma.productOptionGroup.count()).toBe(0);
    expect(await prisma.optionGroup.count()).toBe(1);
  });

  it("groupsForProducts + resolveLine ponta a ponta: pizza G com borda = R$ 68,00 (CA-B8-01) e erro de regra no servidor", async () => {
    const tamanho = await createGroup(tamanhoInput);
    const borda = await createGroup(bordaInput);
    const productId = await createProduct();
    await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [tamanho.id, borda.id] });

    const groups = (await optionGroupsService.groupsForProducts(storeId, [productId])).get(productId)!;
    const gId = tamanho.options.find((o) => o.name === "G")!.id;
    const catupiry = borda.options[0].id;
    expect(resolveLine({ name: "Pizza", priceCents: 5000 }, groups, [{ optionId: gId }, { optionId: catupiry }])).toMatchObject({ ok: true, unitPriceCents: 6800 });
    expect(resolveLine({ name: "Pizza", priceCents: 5000 }, groups, [{ optionId: catupiry }]).ok).toBe(false); // falta o tamanho
  });

  it("revalida a cotação e grava as mesmas escolhas na entrega, retirada, mesa, balcão e impressão", async () => {
    await prisma.store.update({ where: { id: storeId }, data: { deliveryFeeCents: 500, qrOrderingEnabled: true } });
    const productId = await createProduct();
    const additional = await prisma.productAdditional.create({ data: { productId, name: "Orégano", priceCents: 300 } });
    const legacy = await prisma.optionGroup.create({ data: {
      storeId, name: "Adicionais", source: "LEGACY_ADDITIONALS",
      options: { create: { id: additional.id, name: additional.name, priceCents: 200 } },
    } });
    await prisma.productOptionGroup.create({ data: { storeId, productId, groupId: legacy.id } });
    const tamanho = await createGroup(tamanhoInput);
    const borda = await createGroup({ ...bordaInput, maxSelect: 2, maxPerOption: 2 });
    expect((await post(`/api/catalog/products/${productId}/option-groups`, { groupIds: [tamanho.id, borda.id] })).statusCode).toBe(200);
    expect(await prisma.productOptionGroup.count({ where: { productId } })).toBe(3);

    const basePath = "/stores/loja-opc";
    const menu = json(await get(`${basePath}/menu`));
    expect(menu.categories[0].products[0]).toMatchObject({
      fromPriceCents: 3000,
      optionGroups: [{ name: "Tamanho", priceMode: "BASE" }, { name: "Borda", priceMode: "SUM" }],
      additionals: [{ name: "Orégano", priceCents: 300 }],
    });
    const item = {
      productId, quantity: 2, additionalIds: [additional.id], notes: "Bem assada",
      optionSelections: [{ optionId: tamanho.options[2].id, quantity: 1 }, { optionId: borda.options[0].id, quantity: 2 }],
      expectedUnitPriceCents: 7900,
    };
    const publicOrder = (items: unknown[], fields: Record<string, unknown> = {}) => post(`${basePath}/orders`, { type: "BALCAO", items, ...fields });
    const required = await publicOrder([{ productId, quantity: 1 }]);
    expect([required.statusCode, json(required).code]).toEqual([400, "OPTION_REQUIRED"]);
    const stale = await publicOrder([{ ...item, expectedUnitPriceCents: 7600 }]);
    expect([stale.statusCode, json(stale).code]).toEqual([409, "ITEM_PRICE_CHANGED"]);
    expect(json(stale).details.items[0]).toMatchObject({ productId, unitPriceCents: 7900 });
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);

    const pickup = await publicOrder([item]);
    const delivery = await publicOrder([item], { type: "DELIVERY", customerName: "Ana", customerPhone: "21999990000", address: "Rua A, 1" });
    const manual = await post("/api/orders", { type: "BALCAO", items: [item], paymentMethod: "DEBITO" });
    const table = json(await post("/api/tables", { label: "20" })).table;
    const tablePath = `${basePath}/tables/${table.qrToken}`;
    const qr = await post(`${tablePath}/orders`, { items: [item] });
    const responses = [pickup, delivery, manual, qr];
    for (const response of responses) expect(response.statusCode, response.body).toBe(201);

    await prisma.option.update({ where: { id: borda.options[0].id }, data: { name: "Borda nova", priceCents: 999 } });
    const snapshots = [
      { groupName: "Tamanho", name: "G", priceMode: "BASE", priceCents: 6000, quantity: 1 },
      { groupName: "Borda", name: "Catupiry", priceMode: "SUM", priceCents: 800, quantity: 2 },
    ];
    for (const response of responses) {
      const { orderId } = json(response);
      const detail = json(await get(`/api/orders/${orderId}`)).order;
      expect(detail.totalCents).toBe(response === delivery ? 16300 : 15800);
      expect(detail.items[0]).toMatchObject({ unitPriceCents: 6000, notes: item.notes });
      expect(detail.items[0].options).toEqual(expect.arrayContaining(snapshots));
      const ticket = await buildPrintableOrder(orderId);
      expect(ticket?.items[0]).toMatchObject({ productName: "Pizza — G", unitPriceCents: 6000, quantity: 2 });
      expect(ticket?.items[0].additionals).toEqual(expect.arrayContaining([
        { name: "Orégano", priceCents: 300 }, { name: "2× Catupiry", priceCents: 1600 },
      ]));
    }
    const myOrders = await app.inject({ method: "GET", url: `${tablePath}/my-orders`, headers: { "x-device-token": json(qr).deviceToken } });
    expect(json(myOrders).orders[0].items[0].options).toEqual(expect.arrayContaining(snapshots));
  });
});

describe("migração 20261117350000 (adicionais atuais → grupo 'Adicionais', CA-B8-06)", () => {
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("cada produto com adicionais ganha o grupo LEGACY com as MESMAS opções (mesmo id) e preço final idêntico", async () => {
    await resetDb();
    const store = await prisma.store.create({ data: { name: "L", slug: "loja-mig15", code: "MG15" } });
    const category = await prisma.category.create({ data: { storeId: store.id, name: "Lanches" } });
    const burger = await prisma.product.create({ data: { storeId: store.id, categoryId: category.id, name: "Burger", priceCents: 2500 } });
    const plain = await prisma.product.create({ data: { storeId: store.id, categoryId: category.id, name: "Suco", priceCents: 900 } });
    const bacon = await prisma.productAdditional.create({ data: { productId: burger.id, name: "Bacon", priceCents: 400 } });
    const queijo = await prisma.productAdditional.create({ data: { productId: burger.id, name: "Queijo", priceCents: 300 } });

    // a migração é idempotente sobre o estado pós-DDL: limpa o que a própria migração cria e roda só a parte de dados
    await prisma.productOptionGroup.deleteMany();
    await prisma.option.deleteMany();
    await prisma.optionGroup.deleteMany();
    const sql = readFileSync(join(__dirname, "../../../packages/db/prisma/migrations/20261117350000_api15_grupos_de_opcoes/migration.sql"), "utf-8");
    const dataPart = sql.slice(sql.indexOf("INSERT INTO"));
    for (const statement of dataPart.split(/;\s*\n/).map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);

    const groups = await prisma.optionGroup.findMany({ include: { options: true, products: true } });
    expect(groups).toHaveLength(1); // o Suco não tem adicionais: sem grupo
    expect(groups[0]).toMatchObject({ name: "Adicionais", minSelect: 0, maxSelect: null, priceMode: "SUM", source: "LEGACY_ADDITIONALS", storeId: store.id });
    expect(groups[0].products.map((p) => p.productId)).toEqual([burger.id]);
    expect(groups[0].options.map((o) => o.id).sort()).toEqual([bacon.id, queijo.id].sort());
    expect(plain.id).not.toBe(burger.id);

    // CA-B8-06: o preço de qualquer combinação é o mesmo de antes (preço do produto + soma dos adicionais)
    const rows = (await optionGroupsService.groupsForProducts(store.id, [burger.id])).get(burger.id)!;
    const additionals = [bacon, queijo];
    for (const mask of [0, 1, 2, 3]) {
      const chosen = additionals.filter((_, i) => mask & (1 << i));
      const legacyPrice = 2500 + chosen.reduce((sum, a) => sum + a.priceCents, 0);
      const r = resolveLine({ name: "Burger", priceCents: 2500 }, rows, chosen.map((a) => ({ optionId: a.id })));
      expect(r, `máscara ${mask}`).toMatchObject({ ok: true, unitPriceCents: legacyPrice });
    }
  });
});
