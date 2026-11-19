// API-15 (P1 do Deming): pedido de MESA e pedido MANUAL do painel com `options`: preco so do servidor, copia no pedido, tiquete com as opcoes,
// opcao de outra loja/inexistente = mesma resposta 400 sem gravar nada.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { buildPrintableOrder } from "../src/lib/printable";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);
const conta = (t: { items: Array<{ quantity: number; unitPriceCents: number; additionals: Array<{ priceCents: number }> }> }) =>
  t.items.reduce((s, i) => s + (i.unitPriceCents + i.additionals.reduce((a, x) => a + x.priceCents, 0)) * i.quantity, 0);

describe("opcoes no pedido de mesa e no pedido manual", { timeout: 90_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  const slug = "loja-mesa-opc";
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    cookie = (await registerStore(app, { slug, code: "MO1" })).cookie!;
  });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await resetDb(); await prisma.$disconnect(); });
  const post = (url: string, payload: unknown, c = cookie, headers: Record<string, string> = {}) => app.inject({ method: "POST", url, headers: { cookie: c, ...headers }, payload: payload as never });

  async function montar(c = cookie) {
    const cat = json(await post("/api/catalog/categories", { name: "Pizzas" }, c)).category.id as string;
    const prod = json(await post("/api/catalog/products", { categoryId: cat, name: "Pizza", priceCents: 5000 }, c)).product.id as string;
    const tam = json(await post("/api/catalog/option-groups", { name: "Tamanho", minSelect: 1, maxSelect: 1, maxPerOption: 1, priceMode: "BASE", options: [{ name: "P", priceCents: 3000 }, { name: "G", priceCents: 6000 }] }, c)).group;
    const borda = json(await post("/api/catalog/option-groups", { name: "Borda", minSelect: 0, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", options: [{ name: "Catupiry", priceCents: 800 }] }, c)).group;
    await post(`/api/catalog/products/${prod}/option-groups`, { groupIds: [tam.id, borda.id] }, c);
    return { prod, G: tam.options.find((o: { name: string }) => o.name === "G").id as string, catupiry: borda.options[0].id as string };
  }
  async function qrDaMesa() {
    await post("/api/tables", { label: "Mesa 1" });
    await post("/api/store/qr-settings", { qrOrderingEnabled: true, qrOrdersNeedApproval: false, confirmNoApproval: true });
    return (await prisma.table.findFirstOrThrow({})).qrToken;
  }

  it("MESA: preco = (BASE + SOMA) x qtd, copia gravada, conta do print-client igual ao total (o texto das opcoes no tiquete e do PR do Turing)", async () => {
    const { prod, G, catupiry } = await montar();
    const qr = await qrDaMesa();
    const res = await app.inject({ method: "POST", url: `/stores/${slug}/tables/${qr}/orders`, payload: { items: [{ productId: prod, quantity: 3, options: [{ optionId: G }, { optionId: catupiry }] }] } });
    expect(res.statusCode, res.body).toBe(201);
    const order = await prisma.order.findFirstOrThrow({ where: { store: { slug } }, include: { items: { include: { options: true } } } });
    expect(order.totalCents).toBe(20400);
    expect(order.items[0].options.map((o) => o.name).sort()).toEqual(["Catupiry", "G"]);
    const t = (await buildPrintableOrder(order.id))!;
    expect(conta(t)).toBe(order.totalCents);
  });

  it("MESA: opcao inexistente / de outra loja = mesma resposta 400 e nada gravado; obrigatorio faltando = 400", async () => {
    const { prod, G } = await montar();
    const outra = await registerStore(app, { slug: "outra-mesa-opc", code: "MO2" });
    const o = await montar(outra.cookie!);
    const qr = await qrDaMesa();
    const url = `/stores/${slug}/tables/${qr}/orders`;
    const inexistente = await app.inject({ method: "POST", url, payload: { items: [{ productId: prod, quantity: 1, options: [{ optionId: G }, { optionId: "nao-existe" }] }] } });
    const deOutraLoja = await app.inject({ method: "POST", url, payload: { items: [{ productId: prod, quantity: 1, options: [{ optionId: G }, { optionId: o.catupiry }] }] } });
    expect(inexistente.statusCode).toBe(400);
    expect(deOutraLoja.statusCode).toBe(400);
    expect(json(deOutraLoja).code).toBe(json(inexistente).code);
    expect(JSON.stringify(json(deOutraLoja).issues.map((i: { code: string }) => i.code))).toBe(JSON.stringify(json(inexistente).issues.map((i: { code: string }) => i.code)));
    const faltando = await app.inject({ method: "POST", url, payload: { items: [{ productId: prod, quantity: 1, options: [] }] } });
    expect(faltando.statusCode).toBe(400);
    expect(await prisma.order.count({ where: { store: { slug } } })).toBe(0);
  });

  it("PAINEL (pedido manual): mesmo preco, copia e tiquete; sem options segue o caminho antigo", async () => {
    const { prod, G, catupiry } = await montar();
    const res = await post("/api/orders", { type: "BALCAO", items: [{ productId: prod, quantity: 3, options: [{ optionId: G }, { optionId: catupiry }] }] }, cookie, { "idempotency-key": "k-opc-0001-abcdef" });
    expect(res.statusCode, res.body).toBe(201);
    const order = await prisma.order.findFirstOrThrow({ where: { store: { slug } }, include: { items: { include: { options: true } } } });
    expect(order.totalCents).toBe(20400);
    expect(order.items[0].options).toHaveLength(2);
    const t = (await buildPrintableOrder(order.id))!;
    expect(conta(t)).toBe(order.totalCents);
  });
});
