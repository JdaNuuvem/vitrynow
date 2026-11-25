// ESTOQUE E LUCRO — ficha técnica, baixa ao ACEITAR, estorno no cancelamento/desfazer, custo médio ponderado, perdas, contagem,
// margem do cardápio e DRE do período. Caso-guia: hambúrguer com 180 g de carne baixa 180 g do estoque de carne.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { consumptionOf, costCentsOf, unitCostFromTotal, weightedAverage } from "../src/lib/stock";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("estoque — regras puras", () => {
  it("custo unitário, custo médio ponderado e valor da movimentação", () => {
    expect(unitCostFromTotal(40_000, 10_000)).toBe(4000); // R$ 400 por 10 kg = 4 centavos/g
    expect(weightedAverage(10_000, 4000, 10_000, 5000)).toBe(4500);
    expect(weightedAverage(-50, 4000, 1000, 5000)).toBe(5000); // saldo negativo não pondera
    expect(costCentsOf(180, 4000)).toBe(720);
    expect(costCentsOf(-180, 4000)).toBe(-720);
  });
  it("consumo: ficha × quantidade; peso pela fração do quilo; opção × escolhida × itens", () => {
    const recipes = {
      product: new Map([["burger", [{ ingredientId: "carne", quantity: 180 }, { ingredientId: "pao", quantity: 1 }]], ["salada-kg", [{ ingredientId: "alface", quantity: 1000 }]]]),
      option: new Map([["bacon", [{ ingredientId: "bacon", quantity: 30 }]]]),
    };
    const usage = consumptionOf(
      [
        { productId: "burger", quantity: 2, weightGrams: null, options: [{ optionId: "bacon", quantity: 2 }] },
        { productId: "salada-kg", quantity: 1, weightGrams: 350, options: [] },
        { productId: "sem-ficha", quantity: 5, weightGrams: null, options: [] },
      ],
      recipes,
    );
    expect(Object.fromEntries(usage)).toEqual({ carne: 360, pao: 2, bacon: 120, alface: 350 });
  });
});

describe("estoque — integração", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    resetLimits();
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
    const owner = cookie!;
    const call = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown, as = owner) => app.inject({ method, url, headers: { cookie: as }, payload: payload as never });
    const categoryId = json(await call("POST", "/api/catalog/categories", { name: "Lanches" })).category.id as string;
    const burger = json(await call("POST", "/api/catalog/products", { categoryId, name: "X-Burger", priceCents: 3000 })).product.id as string;
    const insumo = async (name: string, unit: "G" | "ML" | "UN", minStockQty?: number) => {
      const r = await call("POST", "/api/stock/ingredients", { name, unit, minStockQty });
      expect(r.statusCode, r.body).toBe(201);
      return json(r).ingredient.id as string;
    };
    const email = `st-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await call("POST", "/api/users", { email, password: "provisoria-12" });
    const staff = ((await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria-12" } })).headers["set-cookie"] as string).split(";")[0];
    return { owner, staff, store, call, burger, categoryId, insumo };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  // carne (R$ 40/kg) e pão (R$ 1 a unidade); X-Burger = 180 g de carne + 1 pão
  async function montar(l: Loja) {
    const carne = await l.insumo("Carne moída", "G", 2000);
    const pao = await l.insumo("Pão brioche", "UN");
    expect((await l.call("POST", `/api/stock/ingredients/${carne}/purchase`, { quantity: 10_000, totalCostCents: 40_000 })).statusCode).toBe(201);
    expect((await l.call("POST", `/api/stock/ingredients/${pao}/purchase`, { quantity: 50, totalCostCents: 5_000 })).statusCode).toBe(201);
    const r = await l.call("PUT", `/api/stock/products/${l.burger}/recipe`, { items: [{ ingredientId: carne, quantity: 180 }, { ingredientId: pao, quantity: 1 }] });
    expect(r.statusCode, r.body).toBe(200);
    expect(json(r).costCents).toBe(720 + 100);
    return { carne, pao };
  }
  const saldo = async (id: string) => (await prisma.ingredient.findUniqueOrThrow({ where: { id } })).stockQty;
  const pedir = async (l: Loja, quantity = 1) => {
    const r = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: l.burger, quantity }] } });
    expect(r.statusCode, r.body).toBe(201);
    return json(r).orderId as string;
  };
  const mover = (l: Loja, id: string, to: string) => l.call("POST", `/api/orders/${id}/transition`, { to }, l.staff);

  it("CASO-GUIA: hambúrguer de 180 g — pedido PENDENTE não mexe; ao ACEITAR baixa 180 g e 1 pão; CMV e custo da linha gravados", async () => {
    const l = await loja();
    const { carne, pao } = await montar(l);
    const id = await pedir(l, 2);
    expect(await saldo(carne)).toBe(10_000); // ainda pendente
    expect((await mover(l, id, "CONFIRMADO")).statusCode).toBe(200);
    expect([await saldo(carne), await saldo(pao)]).toEqual([10_000 - 360, 48]);
    const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect([order.cogsCents, order.items[0].cogsCents]).toEqual([1640, 1640]); // 2 × (7,20 + 1,00)
    const sale = await prisma.stockMovement.findMany({ where: { orderId: id }, orderBy: { ingredientId: "asc" } });
    expect(sale.every((m) => m.type === "SALE" && m.quantity < 0)).toBe(true);
    // avançar mais não baixa de novo
    expect((await mover(l, id, "EM_PREPARO")).statusCode).toBe(200);
    expect(await saldo(carne)).toBe(9640);
  });

  it("cancelar pedido ACEITO devolve o estoque (estorno ao custo da baixa); recusar pendente nunca mexeu", async () => {
    const l = await loja();
    const { carne } = await montar(l);
    const aceito = await pedir(l);
    await mover(l, aceito, "CONFIRMADO");
    const pendente = await pedir(l);
    for (const id of [aceito, pendente]) {
      const c = await l.call("POST", `/api/orders/${id}/cancel`, { reason: { code: "CLIENTE_DESISTIU" } });
      expect(c.statusCode, c.body).toBe(200);
    }
    expect(await saldo(carne)).toBe(10_000);
    const rev = await prisma.stockMovement.findMany({ where: { orderId: aceito, type: "SALE_REVERSAL" } });
    expect(rev.map((m) => [m.quantity, m.unitCostMillicents]).sort()).toEqual([[1, 100_000], [180, 4000]].sort());
    expect(await prisma.stockMovement.count({ where: { orderId: pendente } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: aceito } })).cogsCents).toBeNull();
  });

  it("desfazer o aceite devolve; aceitar de novo baixa UMA vez (idempotente)", async () => {
    const l = await loja();
    const { carne } = await montar(l);
    const id = await pedir(l);
    await mover(l, id, "CONFIRMADO");
    expect((await l.call("POST", `/api/orders/${id}/undo`, undefined, l.staff)).statusCode).toBe(200);
    expect(await saldo(carne)).toBe(10_000);
    await mover(l, id, "CONFIRMADO");
    expect(await saldo(carne)).toBe(9820);
    const net = await prisma.stockMovement.aggregate({ where: { orderId: id, ingredientId: carne }, _sum: { quantity: true } });
    expect(net._sum.quantity).toBe(-180);
  });

  it("pedido que já nasce aceito (lançado no painel) baixa na criação; estoque pode ficar NEGATIVO e vira alerta", async () => {
    const l = await loja();
    const carne = await l.insumo("Carne", "G", 100);
    await l.call("PUT", `/api/stock/products/${l.burger}/recipe`, { items: [{ ingredientId: carne, quantity: 180 }] });
    const r = await l.call("POST", "/api/orders", { type: "BALCAO", items: [{ productId: l.burger, quantity: 1 }], paymentMethod: "DEBITO" });
    expect(r.statusCode, r.body).toBe(201);
    expect(await saldo(carne)).toBe(-180);
    const lista = json(await l.call("GET", "/api/stock/ingredients"));
    expect(lista.ingredients[0]).toMatchObject({ negative: true, lowStock: true });
    expect(lista.alerts).toEqual({ lowStock: 1, negative: 1 });
  });

  it("opção com ficha (bacon extra 30 g × 2) baixa junto do prato", async () => {
    const l = await loja();
    const bacon = await l.insumo("Bacon", "G");
    await l.call("POST", `/api/stock/ingredients/${bacon}/purchase`, { quantity: 1000, totalCostCents: 6000 });
    const group = json(await l.call("POST", "/api/catalog/option-groups", { name: "Extras", minSelect: 0, maxSelect: 3, maxPerOption: 2, priceMode: "SUM", options: [{ name: "Bacon", priceCents: 500 }] })).group;
    expect((await l.call("POST", `/api/catalog/products/${l.burger}/option-groups`, { groupIds: [group.id] })).statusCode).toBe(200);
    const optionId = group.options[0].id as string;
    expect((await l.call("PUT", `/api/stock/options/${optionId}/recipe`, { items: [{ ingredientId: bacon, quantity: 30 }] })).statusCode).toBe(200);
    const r = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: l.burger, quantity: 1, options: [{ optionId, quantity: 2 }] }] } });
    expect(r.statusCode, r.body).toBe(201);
    await mover(l, json(r).orderId, "CONFIRMADO");
    expect(await saldo(bacon)).toBe(940);
  });

  it("custo médio ponderado: nova compra mais cara recalcula; a venda antiga mantém o custo do momento", async () => {
    const l = await loja();
    const { carne } = await montar(l);
    const id = await pedir(l);
    await mover(l, id, "CONFIRMADO"); // 180 g a 4000
    await l.call("POST", `/api/stock/ingredients/${carne}/purchase`, { quantity: 10_000, totalCostCents: 50_000 }); // 5000
    const i = await prisma.ingredient.findUniqueOrThrow({ where: { id: carne } });
    expect(i.unitCostMillicents).toBe(Math.round((9820 * 4000 + 10_000 * 5000) / 19_820));
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).cogsCents).toBe(820);
  });

  it("perdas: equipe lança desperdício e estragado com motivo de lista fechada; contagem só o dono (diferença vira ajuste)", async () => {
    const l = await loja();
    const { carne } = await montar(l);
    expect((await l.call("POST", `/api/stock/ingredients/${carne}/loss`, { type: "WASTE", quantity: 200, reason: "QUEIMOU" }, l.staff)).statusCode).toBe(201);
    expect((await l.call("POST", `/api/stock/ingredients/${carne}/loss`, { type: "SPOILAGE", quantity: 500, reason: "VENCIDO" }, l.staff)).statusCode).toBe(201);
    expect((await l.call("POST", `/api/stock/ingredients/${carne}/loss`, { type: "WASTE", quantity: 1, reason: "texto livre" }, l.staff)).statusCode).toBe(400);
    expect((await l.call("POST", `/api/stock/ingredients/${carne}/count`, { countedQty: 9000 }, l.staff)).statusCode).toBe(403);
    const count = await l.call("POST", `/api/stock/ingredients/${carne}/count`, { countedQty: 9000 });
    expect(json(count).diff).toBe(9000 - 9300);
    expect(await saldo(carne)).toBe(9000);
    // a equipe não recebe custo em lugar nenhum
    const listaStaff = JSON.stringify(json(await l.call("GET", "/api/stock/ingredients", undefined, l.staff)));
    const movStaff = JSON.stringify(json(await l.call("GET", "/api/stock/movements", undefined, l.staff)));
    expect(listaStaff + movStaff).not.toMatch(/Cost|Value/);
    expect((await l.call("GET", "/api/stock/profit", undefined, l.staff)).statusCode).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: { in: ["stock.loss", "stock.count"] } } })).toBeGreaterThanOrEqual(3);
  });

  it("DRE do período: faturamento, CMV, lucro bruto, perdas por motivo e margem real por prato; margem do cardápio", async () => {
    const l = await loja();
    const { carne } = await montar(l);
    const id = await pedir(l, 2); // 2 × 30,00
    await mover(l, id, "CONFIRMADO");
    await l.call("POST", `/api/stock/ingredients/${carne}/loss`, { type: "SPOILAGE", quantity: 1000, reason: "ESTRAGOU" }); // 40,00
    const p = json(await l.call("GET", "/api/stock/profit"));
    expect(p).toMatchObject({ revenueCents: 6000, cogsCents: 1640, grossProfitCents: 4360, losses: { spoilageCents: 4000, wasteCents: 0, totalCents: 4000 }, resultAfterLossesCents: 360 });
    expect(p.lossesByReason).toEqual([{ type: "SPOILAGE", reason: "ESTRAGOU", count: 1, costCents: 4000 }]);
    expect(p.products).toEqual([{ productName: "X-Burger", quantity: 2, revenueCents: 6000, cogsCents: 1640, profitCents: 4360, marginPercent: 72.7, hasCost: true }]);
    const m = json(await l.call("GET", "/api/stock/menu-margins"));
    expect(m.products[0]).toMatchObject({ name: "X-Burger", priceCents: 3000, costCents: 820, marginCents: 2180, costPercent: 27.3, hasRecipe: true });
  });

  it("adicional LEGADO (ProductAdditional) com ficha na opção-espelho dá baixa; ficha sobrevive a editar o produto", async () => {
    const l = await loja();
    const queijo = await l.insumo("Cheddar", "G");
    await l.call("POST", `/api/stock/ingredients/${queijo}/purchase`, { quantity: 1000, totalCostCents: 5000 });
    const created = json(await l.call("POST", "/api/catalog/products", { categoryId: l.categoryId, name: "X-Legado", priceCents: 2000, additionals: [{ name: "Cheddar extra", priceCents: 300 }] })).product;
    const additionalId = created.additionals[0].id as string;
    expect((await l.call("PUT", `/api/stock/options/${additionalId}/recipe`, { items: [{ ingredientId: queijo, quantity: 25 }] })).statusCode).toBe(200);
    // editar o produto (renomear o adicional) não apaga a ficha: o espelho é atualizado pelo mesmo id
    await l.call("POST", `/api/catalog/products/${created.id}`, { additionals: [{ id: additionalId, name: "Cheddar duplo", priceCents: 400 }] });
    expect(await prisma.optionRecipeItem.count({ where: { optionId: additionalId } })).toBe(1);
    const r = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: created.id, quantity: 2, additionalIds: [additionalId] }] } });
    expect(r.statusCode, r.body).toBe(201);
    await mover(l, json(r).orderId, "CONFIRMADO");
    expect(await saldo(queijo)).toBe(1000 - 50);
  });

  it("alerta de estoque: só no CRUZAMENTO do mínimo (LOW) e ao ficar negativo (NEGATIVE)", async () => {
    const l = await loja();
    const carne = await l.insumo("Carne", "G", 500);
    await l.call("POST", `/api/stock/ingredients/${carne}/purchase`, { quantity: 700, totalCostCents: 2800 });
    const { applyMovement } = await import("../src/lib/stock");
    const move = (quantity: number) => prisma.$transaction((tx) => applyMovement(tx, { storeId: l.store.id, ingredientId: carne, type: "WASTE", quantity, reason: "PREPARO", now: new Date() }));
    expect((await move(-100)).alert).toBeNull(); // 600: acima do mínimo
    expect((await move(-100)).alert).toEqual({ ingredientId: carne, kind: "LOW" }); // 500: cruzou
    expect((await move(-100)).alert).toBeNull(); // 400: já estava abaixo
    expect((await move(-500)).alert).toEqual({ ingredientId: carne, kind: "NEGATIVE" }); // -100
  });

  it("CSV do lucro: resumo, produtos, perdas e movimentações; só o dono; auditado", async () => {
    const l = await loja();
    const { carne } = await montar(l);
    await mover(l, await pedir(l), "CONFIRMADO");
    await l.call("POST", `/api/stock/ingredients/${carne}/loss`, { type: "WASTE", quantity: 100, reason: "CAIU" });
    for (const table of ["summary", "products", "losses", "movements"]) {
      const r = await l.call("GET", `/api/stock/export.csv?table=${table}`);
      expect(r.statusCode, table).toBe(200);
      expect(r.headers["content-type"]).toContain("text/csv");
    }
    const resumo = (await l.call("GET", "/api/stock/export.csv?table=summary")).body;
    expect(resumo).toContain("CMV (R$);8,20");
    expect((await l.call("GET", "/api/stock/export.csv?table=movements")).body).toContain("Desperdício");
    expect((await l.call("GET", "/api/stock/export.csv?table=nada")).statusCode).toBe(400);
    expect((await l.call("GET", "/api/stock/export.csv", undefined, l.staff)).statusCode).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: "stock.export" } })).toBeGreaterThanOrEqual(4);
  });

  it("isolamento e integridade: ficha com insumo de outra loja é 404; nome repetido 409; movimentação nunca some (insumo com histórico não se apaga)", async () => {
    const a = await loja();
    const b = await loja();
    const alheio = await b.insumo("Queijo", "G");
    expect((await a.call("PUT", `/api/stock/products/${a.burger}/recipe`, { items: [{ ingredientId: alheio, quantity: 10 }] })).statusCode).toBe(404);
    expect((await a.call("POST", `/api/stock/ingredients/${alheio}/purchase`, { quantity: 1, totalCostCents: 1 })).statusCode).toBe(404);
    await a.insumo("Queijo", "G");
    expect((await a.call("POST", "/api/stock/ingredients", { name: "Queijo", unit: "G" })).statusCode).toBe(409);
    await b.call("POST", `/api/stock/ingredients/${alheio}/purchase`, { quantity: 100, totalCostCents: 500 });
    await expect(prisma.ingredient.delete({ where: { id: alheio } })).rejects.toThrow();
    expect(await prisma.stockMovement.count({ where: { ingredientId: alheio } })).toBe(1);
  });
});
