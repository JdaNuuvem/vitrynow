// Produto detalhado (PD, carimbo 790000): preço de/por com vigência, venda por peso (arredondamento half-up), adicional que não vende sozinho, DTO por allowlist,
// auditoria e papéis. O servidor é a única fonte do preço; o mesmo número sai na vitrine, na mesa/QR e no pedido manual.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { buildPrintableOrder } from "../src/lib/printable";
import { checkWeight, effectivePriceCents, promoActive, promoAboveHalf, weightLineCents, type PricedProduct } from "../src/lib/productPrice";
import { PUBLIC_PRODUCT_KEYS } from "../src/lib/publicDto";
import { login, makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("produto detalhado: regras puras de preço", () => {
  const base: PricedProduct = { priceCents: 3000, promoCents: 2400, promoStartsAt: null, promoEndsAt: null, saleUnit: "UN", minGrams: 100, stepGrams: 50, maxGrams: 5000 };

  it("peso: round half-up ao centavo, uma vez por linha (49,90/kg×400 g=1.996; 59,90/kg×350 g=2.097; 7,90/100 g=79,00/kg×350 g=2.765)", () => {
    expect(weightLineCents(4990, 400)).toBe(1996);
    expect(weightLineCents(5990, 350)).toBe(2097); // 2.096,5 arredonda PARA CIMA
    expect(weightLineCents(7900, 350)).toBe(2765);
    expect(weightLineCents(4990, 350)).toBe(1747); // promo por quilo (S1 do Deming): 49,90 × 350 g
    expect(weightLineCents(1, 1)).toBe(0); // 0,001 centavo => 0 (sub-centavo nunca vira cobrança maior)
    expect(weightLineCents(100_000_000, 5000)).toBe(500_000_000); // sem estouro de inteiro seguro
  });

  it("vigência é início ≤ agora < fim, com o relógio recebido: 23:59:59.999 ativa, 00:00:00.000 do dia seguinte inativa; futura e sem datas", () => {
    const fim = new Date("2026-11-21T03:00:00.000Z"); // 00:00 de 21/11 em São Paulo (promoção "até 20/11")
    const p = { ...base, promoStartsAt: new Date("2026-11-18T03:00:00.000Z"), promoEndsAt: fim };
    expect(promoActive(p, new Date("2026-11-21T02:59:59.999Z"))).toBe(true);
    expect(promoActive(p, new Date("2026-11-21T03:00:00.000Z"))).toBe(false);
    expect(promoActive(p, new Date("2026-11-18T02:59:59.999Z"))).toBe(false); // ainda não começou
    expect(promoActive(p, new Date("2026-11-18T03:00:00.000Z"))).toBe(true);
    expect(promoActive(base, new Date("2030-01-01T00:00:00Z"))).toBe(true); // sem datas: até o dono desligar
    expect(effectivePriceCents(p, new Date("2026-11-21T03:00:00.000Z"))).toBe(3000); // vencida = preço real, sem erro
    expect(effectivePriceCents({ ...base, promoCents: null }, new Date())).toBe(3000);
  });

  it("limites de peso e acima de 50% em inteiros (R$ 30,00: 15,00 passa, 14,99 não)", () => {
    expect(checkWeight(base, 50)?.code).toBe("WEIGHT_OUT_OF_RANGE");
    expect(checkWeight(base, 5050)?.code).toBe("WEIGHT_OUT_OF_RANGE");
    expect(checkWeight(base, 130)?.code).toBe("WEIGHT_STEP_INVALID");
    expect(checkWeight(base, 100)).toBeNull();
    expect(checkWeight(base, 400)).toBeNull();
    expect(promoAboveHalf(3000, 1500)).toBe(false);
    expect(promoAboveHalf(3000, 1499)).toBe(true);
  });
});

describe("produto detalhado: API", { timeout: 120_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  let storeId: string;
  let credentials: { password: string };
  const slug = "loja-pd";
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    const r = await registerStore(app, { slug, code: "PD1" });
    cookie = r.cookie!;
    storeId = json(r.response).store.id;
    credentials = r.credentials;
    categoriaId = null;
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
  let categoriaId: string | null = null;
  async function categoria() {
    if (!categoriaId) categoriaId = json(await post("/api/catalog/categories", { name: "Pratos" })).category.id as string;
    return categoriaId;
  }
  async function produto(over: Record<string, unknown> = {}, c = cookie) {
    const categoryId = await categoria();
    const res = await post("/api/catalog/products", { categoryId, name: "Prato", priceCents: 3000, ...over }, c);
    return { res, id: json(res).product?.id as string, categoryId };
  }
  const pedido = (items: unknown[], extra: Record<string, unknown> = {}) => app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", items, ...extra } });
  const ultimo = () => prisma.order.findFirstOrThrow({ where: { storeId }, orderBy: { createdAt: "desc" }, include: { items: true } });
  const menu = async () => json(await app.inject({ method: "GET", url: `/stores/${slug}/menu` })).categories[0].products as Array<Record<string, unknown>>;

  it("promoção: 24,00 sobre 30,00 ativa => pedido grava unitário 2.400 e lista 3.000; subtotal e tíquete usam 2.400; DTO público mostra a promoção", async () => {
    const p = await produto({ promoCents: 2400 });
    expect(p.res.statusCode, p.res.body).toBe(201);
    const res = await pedido([{ productId: p.id, quantity: 2 }]);
    expect(res.statusCode, res.body).toBe(201);
    const o = await ultimo();
    expect(o.subtotalCents).toBe(4800);
    expect(o.items[0]).toMatchObject({ unitPriceCents: 2400, listPriceCents: 3000, weightGrams: null });
    expect((await buildPrintableOrder(o.id))!.items[0]).toMatchObject({ unitPriceCents: 2400, quantity: 2 });
    expect((await menu())[0]).toMatchObject({ priceCents: 3000, promoCents: 2400, promoEndsAt: null });
  });

  it("promoção vencida ou futura = preço real, sem erro, e nunca aparece no DTO público; pedido antigo não muda", async () => {
    const p = await produto({ promoCents: 2400 });
    await pedido([{ productId: p.id, quantity: 1 }]);
    const antes = await ultimo();
    await prisma.product.update({ where: { id: p.id }, data: { promoStartsAt: new Date(Date.now() - 86_400_000 * 5), promoEndsAt: new Date(Date.now() - 1000) } }); // vencida há 1 s
    const res = await pedido([{ productId: p.id, quantity: 1 }]);
    expect(res.statusCode, res.body).toBe(201);
    const todos = await prisma.orderItem.findMany({ orderBy: { id: "asc" }, where: { order: { storeId } }, include: { order: true } });
    const novo = todos.find((i) => i.orderId !== antes.id)!;
    expect(novo).toMatchObject({ unitPriceCents: 3000, listPriceCents: null });
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: antes.id } })).unitPriceCents).toBe(2400);
    const dto = (await menu())[0];
    expect(dto).toMatchObject({ promoCents: null, promoEndsAt: null });
    expect(JSON.stringify(dto)).not.toContain("promoStartsAt");
    await prisma.product.update({ where: { id: p.id }, data: { promoStartsAt: new Date(Date.now() + 86_400_000), promoEndsAt: null } }); // futura
    expect((await menu())[0]).toMatchObject({ promoCents: null });
    const futura = await pedido([{ productId: p.id, quantity: 1 }]);
    expect(futura.statusCode).toBe(201);
    expect((await ultimo()).items[0].unitPriceCents).toBe(3000);
  });

  it("vigência por datas no FUSO DA LOJA: 'até 20/11' vira início 00:00 e fim 00:00 do dia seguinte em UTC (São Paulo −03:00)", async () => {
    const p = await produto({ promoCents: 2400, promoStartsOn: "2099-11-18", promoEndsOn: "2099-11-20" });
    expect(p.res.statusCode, p.res.body).toBe(201);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.promoStartsAt?.toISOString()).toBe("2099-11-18T03:00:00.000Z");
    expect(row.promoEndsAt?.toISOString()).toBe("2099-11-21T03:00:00.000Z");
  });

  it("validações da promoção: ≥ normal, data final no passado, início depois do fim e preço normal editado para ≤ promoção = 400 com o código; nada gravado", async () => {
    const p = await produto({ promoCents: 2400 });
    const codigo = async (payload: Record<string, unknown>) => {
      const r = await post(`/api/catalog/products/${p.id}`, payload);
      return [r.statusCode, json(r).code];
    };
    expect(await codigo({ promoCents: 3000 })).toEqual([400, "PROMO_INVALID"]);
    expect(await codigo({ promoCents: 3500 })).toEqual([400, "PROMO_INVALID"]);
    expect(await codigo({ promoEndsOn: "2020-01-01" })).toEqual([400, "PROMO_EXPIRY_INVALID"]);
    expect(await codigo({ promoStartsOn: "2099-12-10", promoEndsOn: "2099-12-01" })).toEqual([400, "PROMO_INVALID"]);
    expect(await codigo({ priceCents: 2400 })).toEqual([400, "PROMO_INVALID"]); // editar o normal para ≤ promoção
    expect(await codigo({ priceCents: 2000 })).toEqual([400, "PROMO_INVALID"]);
    expect(await codigo({ priceCents: 3200 })).toEqual([200, undefined]);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ priceCents: 3200, promoCents: 2400 });
  });

  it("produto com grupo BASE não aceita promoção (e vice-versa); adicional não tem grupos; produto por peso não aceita opções", async () => {
    const p = await produto();
    const g = json(await post("/api/catalog/option-groups", { name: "Tamanho", minSelect: 1, maxSelect: 1, maxPerOption: 1, priceMode: "BASE", options: [{ name: "P", priceCents: 3000 }, { name: "G", priceCents: 4000 }] })).group;
    expect((await post(`/api/catalog/products/${p.id}/option-groups`, { groupIds: [g.id] })).statusCode).toBe(200);
    const promo = await post(`/api/catalog/products/${p.id}`, { promoCents: 2000 });
    expect([promo.statusCode, json(promo).code]).toEqual([400, "PROMO_NOT_ALLOWED"]);
    const outro = await produto({ promoCents: 2000 });
    const ligar = await post(`/api/catalog/products/${outro.id}/option-groups`, { groupIds: [g.id] });
    expect([ligar.statusCode, json(ligar).code]).toEqual([400, "PROMO_NOT_ALLOWED"]);
    const peso = await post(`/api/catalog/products/${p.id}`, { saleUnit: "KG" });
    expect([peso.statusCode, json(peso).code]).toEqual([400, "PRODUCT_WEIGHT_NO_OPTIONS"]);
    const adicional = await produto({ kind: "ADICIONAL", name: "Ovo" });
    const grupo = await post(`/api/catalog/products/${adicional.id}/option-groups`, { groupIds: [g.id] });
    expect([grupo.statusCode, json(grupo).code]).toEqual([400, "ADDON_HAS_GROUPS"]);
    const porPeso = await produto({ saleUnit: "KG", name: "Quilo" });
    const ligaPeso = await post(`/api/catalog/products/${porPeso.id}/option-groups`, { groupIds: [g.id] });
    expect([ligaPeso.statusCode, json(ligaPeso).code]).toEqual([400, "PRODUCT_WEIGHT_NO_OPTIONS"]);
  });

  it("STAFF no PRO: até 50% passa (30,00 → 15,00), acima (14,99) = 403 FORBIDDEN_ROLE; o dono aplica; toda mudança de promoção grava auditoria", async () => {
    const p = await produto();
    const bcrypt = await import("bcryptjs");
    await prisma.user.create({ data: { storeId, email: "staff-pd@teste.com", passwordHash: await bcrypt.hash(credentials.password, 10), role: "STAFF" } });
    const staff = (await login(app, "staff-pd@teste.com", credentials.password)).cookie!;
    const acima = await post(`/api/catalog/products/${p.id}`, { promoCents: 1499 }, staff);
    expect([acima.statusCode, json(acima).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).promoCents).toBeNull();
    expect((await post(`/api/catalog/products/${p.id}`, { promoCents: 1500 }, staff)).statusCode).toBe(200);
    expect((await post(`/api/catalog/products/${p.id}`, { promoCents: 1000 })).statusCode).toBe(200); // dono
    await new Promise((resolve) => setTimeout(resolve, 300));
    const logs = await prisma.auditLog.findMany({ where: { storeId, action: "product.promo_change" }, orderBy: { createdAt: "asc" } });
    expect(logs).toHaveLength(2);
    expect(logs[1].metadata).toMatchObject({ beforeCents: 1500, afterCents: 1000 });
  });

  it("cupom incide sobre o subtotal PROMOCIONAL (10% de R$ 24,00 = 2,40, não 3,00)", async () => {
    const p = await produto({ promoCents: 2400 });
    expect((await post("/api/coupons", { code: "DEZ10", discountType: "PERCENT", discountValue: 10 })).statusCode).toBe(201);
    const res = await pedido([{ productId: p.id, quantity: 1 }], { couponCode: "DEZ10" });
    expect(res.statusCode, res.body).toBe(201);
    const o = await ultimo();
    expect(o).toMatchObject({ subtotalCents: 2400, discountCents: 240, totalCents: 2160 });
  });

  it("venda por peso: R$ 49,90/kg × 400 g = 1.996 (quantity 1); 59,90 × 350 g = 2.097; erros de quantidade, faixa e passo; tíquete 'Nome (400 g)'; painel recebe peso e preço do quilo", async () => {
    const p = await produto({ saleUnit: "KG", priceCents: 4990, name: "Feijoada" });
    expect(p.res.statusCode, p.res.body).toBe(201);
    const ok = await pedido([{ productId: p.id, quantity: 1, weightGrams: 400 }]);
    expect(ok.statusCode, ok.body).toBe(201);
    const o = await ultimo();
    expect(o.subtotalCents).toBe(1996);
    expect(o.items[0]).toMatchObject({ quantity: 1, unitPriceCents: 1996, weightGrams: 400, pricePerKgCents: 4990 });
    const tk = (await buildPrintableOrder(o.id))!;
    expect(tk.items[0]).toMatchObject({ productName: "Feijoada (400 g)", unitPriceCents: 1996, quantity: 1 });
    const detalhe = json(await app.inject({ method: "GET", url: `/api/orders/${o.id}`, headers: { cookie } })).order;
    expect(detalhe.items[0]).toMatchObject({ weightGrams: 400, pricePerKgCents: 4990, unitPriceCents: 1996 });
    const q = await pedido([{ productId: p.id, quantity: 2, weightGrams: 400 }]);
    expect([q.statusCode, json(q).code]).toEqual([400, "WEIGHT_QUANTITY_INVALID"]);
    const faixa = await pedido([{ productId: p.id, quantity: 1, weightGrams: 50 }]);
    expect([faixa.statusCode, json(faixa).code]).toEqual([400, "WEIGHT_OUT_OF_RANGE"]);
    const sem = await pedido([{ productId: p.id, quantity: 1 }]);
    expect([sem.statusCode, json(sem).code]).toEqual([400, "WEIGHT_OUT_OF_RANGE"]);
    const passo = await pedido([{ productId: p.id, quantity: 1, weightGrams: 130 }]);
    expect([passo.statusCode, json(passo).code]).toEqual([400, "WEIGHT_STEP_INVALID"]);
    const comOpcao = await pedido([{ productId: p.id, quantity: 1, weightGrams: 400, options: [{ optionId: "x" }] }]);
    expect([comOpcao.statusCode, json(comOpcao).code]).toEqual([400, "PRODUCT_WEIGHT_NO_OPTIONS"]);
    expect(await prisma.order.count({ where: { storeId } })).toBe(1);
    const q2 = await produto({ saleUnit: "KG", priceCents: 5990, name: "Carne" });
    expect((await pedido([{ productId: q2.id, quantity: 1, weightGrams: 350 }])).statusCode).toBe(201);
    expect((await ultimo()).subtotalCents).toBe(2097);
  });

  it("promoção por QUILO: 59,90/kg com promo 49,90/kg × 350 g = 1.747 e lista 2.097; mesmo número na mesa/QR e no pedido manual", async () => {
    const p = await produto({ saleUnit: "KG", priceCents: 5990, promoCents: 4990, name: "Carne" });
    expect(p.res.statusCode, p.res.body).toBe(201);
    const publico = await pedido([{ productId: p.id, quantity: 1, weightGrams: 350 }]);
    expect(publico.statusCode, publico.body).toBe(201);
    expect((await ultimo()).items[0]).toMatchObject({ unitPriceCents: 1747, listPriceCents: 2097, weightGrams: 350, pricePerKgCents: 4990 });
    const manual = await post("/api/orders", { type: "BALCAO", items: [{ productId: p.id, quantity: 1, weightGrams: 350 }], paymentMethod: "DEBITO" });
    expect(manual.statusCode, manual.body).toBe(201);
    expect((await ultimo()).items[0].unitPriceCents).toBe(1747);
    await post("/api/tables", { label: "7" });
    await post("/api/store/qr-settings", { qrOrderingEnabled: true, qrOrdersNeedApproval: false, confirmNoApproval: true });
    const qr = (await prisma.table.findFirstOrThrow({})).qrToken;
    const mesa = await app.inject({ method: "POST", url: `/stores/${slug}/tables/${qr}/orders`, payload: { items: [{ productId: p.id, quantity: 1, weightGrams: 350 }] } });
    expect(mesa.statusCode, mesa.body).toBe(201);
    expect((await ultimo()).items[0]).toMatchObject({ unitPriceCents: 1747, listPriceCents: 2097 });
  });

  it("preço esperado divergente = 409 ITEM_PRICE_CHANGED sem gravar nada (promoção acabou; por peso o esperado é o valor da linha); esperado correto passa e nunca altera o preço", async () => {
    const p = await produto({ promoCents: 2400 });
    const certo = await pedido([{ productId: p.id, quantity: 1, expectedUnitPriceCents: 2400 }]);
    expect(certo.statusCode, certo.body).toBe(201);
    await prisma.product.update({ where: { id: p.id }, data: { promoEndsAt: new Date(Date.now() - 1000) } }); // a promoção acabou depois que o cliente viu 24,00
    const antes = await prisma.order.count();
    const stale = await pedido([{ productId: p.id, quantity: 1, expectedUnitPriceCents: 2400 }]);
    expect([stale.statusCode, json(stale).code]).toEqual([409, "ITEM_PRICE_CHANGED"]);
    expect(json(stale).details.items[0]).toMatchObject({ unitPriceCents: 3000 });
    expect(await prisma.order.count()).toBe(antes);
    const w = await produto({ saleUnit: "KG", priceCents: 4990, name: "Quilo" });
    expect((await pedido([{ productId: w.id, quantity: 1, weightGrams: 400, expectedUnitPriceCents: 1996 }])).statusCode).toBe(201);
    const wr = await pedido([{ productId: w.id, quantity: 1, weightGrams: 400, expectedUnitPriceCents: 4990 }]); // mandou o preço do quilo, não o da linha
    expect(wr.statusCode).toBe(409);
    expect(await prisma.order.count()).toBe(antes + 1);
  });

  it("adicional (kind ADICIONAL): nasce sem vender sozinho, some da vitrine e não vende (409 PRODUCT_ADDON_NOT_SOLD_ALONE); 'também vender sozinho' o libera", async () => {
    const ad = await produto({ kind: "ADICIONAL", name: "Ovo", priceCents: 300 });
    expect(ad.res.statusCode, ad.res.body).toBe(201);
    expect(json(ad.res).product).toMatchObject({ kind: "ADICIONAL", sellAlone: false });
    const prato = await produto({ name: "Prato" });
    const nomes = (await menu()).map((x) => x.name);
    expect((await menuAll()).includes("Ovo")).toBe(false);
    void nomes;
    const venda = await pedido([{ productId: ad.id, quantity: 1 }]);
    expect([venda.statusCode, json(venda).code]).toEqual([409, "PRODUCT_ADDON_NOT_SOLD_ALONE"]);
    expect(await prisma.order.count()).toBe(0);
    expect((await post(`/api/catalog/products/${ad.id}`, { sellAlone: true })).statusCode).toBe(200);
    expect((await pedido([{ productId: ad.id, quantity: 1 }])).statusCode).toBe(201);
    void prato;
  });

  async function menuAll() {
    const body = json(await app.inject({ method: "GET", url: `/stores/${slug}/menu` }));
    return body.categories.flatMap((c: { products: Array<{ name: string }> }) => c.products.map((x) => x.name)) as string[];
  }

  it("DTO público: chaves EXATAS (sem sku, promoStartsAt, listPriceCents, storeId); por peso mostra faixa e esconde gramatura; por unidade esconde a faixa; prato único", async () => {
    const un = await produto({ isSingleDish: true, portionGrams: 400, serves: 1, name: "Executivo" });
    expect(un.res.statusCode, un.res.body).toBe(201);
    const kg = await produto({ saleUnit: "KG", priceCents: 4990, name: "Quilo", minGrams: 200, stepGrams: 100, maxGrams: 2000 });
    expect(kg.res.statusCode, kg.res.body).toBe(201);
    const produtos = json(await app.inject({ method: "GET", url: `/stores/${slug}/menu` })).categories.flatMap((c: { products: Array<Record<string, unknown>> }) => c.products);
    const dtoUn = produtos.find((x: Record<string, unknown>) => x.name === "Executivo");
    const dtoKg = produtos.find((x: Record<string, unknown>) => x.name === "Quilo");
    for (const dto of produtos) expect(Object.keys(dto).sort()).toEqual([...PUBLIC_PRODUCT_KEYS].sort());
    expect(dtoUn).toMatchObject({ saleUnit: "UN", minGrams: null, portionGrams: 400, serves: 1, isSingleDish: true, sellAlone: true });
    expect(dtoKg).toMatchObject({ saleUnit: "KG", minGrams: 200, stepGrams: 100, maxGrams: 2000, portionGrams: null, serves: null });
    const texto = JSON.stringify(produtos);
    for (const proibido of ["sku", "promoStartsAt", "listPriceCents", "storeId", "pricePerKgCents", "createdAt"]) expect(texto).not.toContain(`"${proibido}"`);
  });

  it("produto antigo (sem nenhum campo novo) continua idêntico: unitário = preço, sem cópias; e a loja B nunca altera produto da A (404)", async () => {
    const p = await produto();
    expect((await pedido([{ productId: p.id, quantity: 3 }])).statusCode).toBe(201);
    const o = await ultimo();
    expect(o).toMatchObject({ subtotalCents: 9000 });
    expect(o.items[0]).toMatchObject({ unitPriceCents: 3000, listPriceCents: null, weightGrams: null, pricePerKgCents: null });
    const b = await registerStore(app, { slug: "loja-pd-b", code: "PD2" });
    const invasor = await post(`/api/catalog/products/${p.id}`, { promoCents: 100 }, b.cookie!);
    expect(invasor.statusCode).toBe(404);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).promoCents).toBeNull();
  });
});
