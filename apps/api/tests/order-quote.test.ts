// PR-06 (b1): a COTAÇÃO (`POST /stores/:slug/quote`) e a CRIAÇÃO do pedido usam a mesma conta (`lib/orderQuote.ts`). Este teste prova a PARIDADE: para cada caso, o total, o subtotal,
// o desconto e a taxa da cotação são EXATAMENTE os do pedido criado; e quando a criação recusa por regra de pedido (mínimo, cupom, bairro), a cotação recusa com o mesmo status e corpo.
// Item que não pode ser pedido (esgotado, pausado, adicional, peso fora da faixa) vem marcado na cotação (`available:false`) e a criação o recusa.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("PR-06: cotação × criação do pedido (paridade)", { timeout: 300_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  let cookie2: string;
  const slug = "loja-q1";
  const slug2 = "loja-q2";
  const id: Record<string, string> = {};
  let n = 0;

  const post = (url: string, payload: unknown, c = cookie) => app.inject({ method: "POST", url, headers: { cookie: c }, payload: payload as never });
  const quote = (s: string, payload: unknown) => app.inject({ method: "POST", url: `/stores/${s}/quote`, payload: payload as never });
  const phone = () => `1198${String(1000000 + ++n).slice(0, 7)}`; // um telefone por pedido (limite de pendentes por telefone)
  const create = (s: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/stores/${s}/orders`, payload: { paymentMethod: "DINHEIRO", customerPhone: phone(), address: "Rua A, 1", ...payload } as never });

  beforeAll(async () => {
    app = makeApp();
    await app.ready();
    await resetDb();
    const a = await registerStore(app, { slug, code: "QQ1" });
    cookie = a.cookie!;
    const b = await registerStore(app, { slug: slug2, code: "QQ2" });
    cookie2 = b.cookie!;
    const storeId = json(a.response).store.id as string;
    const cat = json(await post("/api/catalog/categories", { name: "Pratos" })).category.id as string;
    const prod = async (key: string, payload: Record<string, unknown>) => {
      const r = await post("/api/catalog/products", { categoryId: cat, priceCents: 1000, name: key, ...payload });
      expect(r.statusCode, `${key}: ${r.body}`).toBe(201);
      id[key] = json(r).product.id;
      return json(r).product;
    };
    await prod("UN", { priceCents: 3000 });
    await prod("PROMO", { priceCents: 3000, promoCents: 2400 });
    await prod("KG", { priceCents: 4990, saleUnit: "KG" });
    await prod("KGPROMO", { priceCents: 5990, promoCents: 4990, saleUnit: "KG" });
    const leg = await prod("LEGADO", { priceCents: 1000, additionals: [{ name: "Gelo", priceCents: 200 }] });
    id.gelo = leg.additionals[0].id;
    const both = await prod("MISTO", { priceCents: 2000, additionals: [{ name: "Ovo", priceCents: 300 }] });
    id.ovo = both.additionals[0].id;
    const opt = await prod("OPCOES", { priceCents: 5000 });
    const tam = json(await post("/api/catalog/option-groups", { name: "Tamanho", minSelect: 1, maxSelect: 1, maxPerOption: 1, priceMode: "BASE", options: [{ name: "P", priceCents: 3000 }, { name: "G", priceCents: 6000 }] })).group;
    const borda = json(await post("/api/catalog/option-groups", { name: "Borda", minSelect: 0, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", options: [{ name: "Catupiry", priceCents: 800 }] })).group;
    await post(`/api/catalog/products/${opt.id}/option-groups`, { groupIds: [tam.id, borda.id] });
    id.G = tam.options.find((o: { name: string }) => o.name === "G").id;
    id.catupiry = borda.options[0].id;
    const molho = json(await post("/api/catalog/option-groups", { name: "Molho", minSelect: 0, maxSelect: 2, maxPerOption: 1, priceMode: "SUM", options: [{ name: "Alho", priceCents: 150 }] })).group;
    await post(`/api/catalog/products/${both.id}/option-groups`, { groupIds: [molho.id] });
    id.alho = molho.options[0].id;
    const sold = await prod("ESGOTADO", {});
    await post(`/api/catalog/products/${sold.id}/sold-out`, { soldOut: true, duration: "MANUAL" });
    const off = await prod("PAUSADO", {});
    await post(`/api/catalog/products/${off.id}`, { active: false });
    await prod("ADICIONAL", { kind: "ADICIONAL", priceCents: 300 });
    for (const [code, body] of Object.entries({
      PCT10: { discountType: "PERCENT", discountValue: 10 },
      FIX500: { discountType: "FIXED", discountValue: 500 },
      FIXGRANDE: { discountType: "FIXED", discountValue: 999999 },
      MIN5000: { discountType: "PERCENT", discountValue: 10, minOrderCents: 5000 },
    })) {
      expect((await post("/api/coupons", { code, ...body })).statusCode, code).toBe(201);
    }
    // Loja 1: bairros (a taxa vem do bairro). Loja 2: taxa única, frete grátis geral e pedido mínimo.
    await prisma.deliveryZone.createMany({
      data: [
        { storeId, name: "Centro", nameKey: "centro", feeCents: 700 },
        { storeId, name: "Bairro Rico", nameKey: "bairro rico", feeCents: 900, freeFromCents: 5000 },
      ],
    });
    const zones = await prisma.deliveryZone.findMany({ where: { storeId } });
    id.centro = zones.find((z) => z.nameKey === "centro")!.id;
    id.rico = zones.find((z) => z.nameKey === "bairro rico")!.id;
    const cat2 = json(await post("/api/catalog/categories", { name: "Pratos" }, cookie2)).category.id as string;
    id.UN2 = json(await post("/api/catalog/products", { categoryId: cat2, name: "Prato", priceCents: 2000 }, cookie2)).product.id;
    await post("/api/store/settings", { deliveryFeeCents: 600, minOrderCents: 1500 }, cookie2);
    await prisma.store.updateMany({ where: { slug: slug2 }, data: { freeShippingFromCents: 4000 } });
    await post("/api/coupons", { code: "PCT10", discountType: "PERCENT", discountValue: 10 }, cookie2);
  }, 300_000);
  // Os tetos de requisição do servidor são por INSTÂNCIA e por minuto, e cada caso cria pedidos reais: uma instância nova por caso (os dados do beforeAll ficam no banco).
  beforeEach(async () => {
    resetLimits(); // o limitador por chave é do MÓDULO (global ao processo): zera entre os casos
    await app.close();
    app = makeApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await resetDb();
    await prisma.$disconnect();
  });

  const item = (key: string, over: Record<string, unknown> = {}) => ({ productId: id[key], quantity: 1, ...over });

  // Caso feliz: cotação e pedido criado têm os MESMOS números (subtotal, desconto, taxa, total).
  const paridade: Array<[string, string, () => Record<string, unknown>, number]> = [
    ["1 unidade simples x2", slug, () => ({ type: "BALCAO", items: [item("UN", { quantity: 2 })] }), 6000],
    ["2 promoção por unidade x3", slug, () => ({ type: "BALCAO", items: [item("PROMO", { quantity: 3 })] }), 7200],
    ["3 promoção por quilo 350 g", slug, () => ({ type: "BALCAO", items: [item("KGPROMO", { weightGrams: 350 })] }), 1747],
    ["4 peso 400 g", slug, () => ({ type: "BALCAO", items: [item("KG", { weightGrams: 400 })] }), 1996],
    ["5 variação BASE + opção SOMA x3", slug, () => ({ type: "BALCAO", items: [item("OPCOES", { quantity: 3, options: [{ optionId: id.G }, { optionId: id.catupiry }] })] }), 20400],
    ["6 adicional legado", slug, () => ({ type: "BALCAO", items: [item("LEGADO", { additionalIds: [id.gelo] })] }), 1200],
    ["7 opção + adicional legado no mesmo item", slug, () => ({ type: "BALCAO", items: [item("MISTO", { quantity: 2, additionalIds: [id.ovo], options: [{ optionId: id.alho }] })] }), 2 * (2000 + 300 + 150)],
    ["8 cupom percentual", slug, () => ({ type: "BALCAO", items: [item("UN")], couponCode: "pct10" }), 2700],
    ["9 cupom fixo", slug, () => ({ type: "BALCAO", items: [item("UN")], couponCode: "FIX500" }), 2500],
    ["10 cupom fixo maior que o subtotal (limitado ao subtotal)", slug, () => ({ type: "BALCAO", items: [item("UN")], couponCode: "FIXGRANDE" }), 0],
    ["11 cupom sobre o preço PROMOCIONAL", slug, () => ({ type: "BALCAO", items: [item("PROMO")], couponCode: "PCT10" }), 2160],
    ["12 cupom com mínimo atendido", slug, () => ({ type: "BALCAO", items: [item("UN", { quantity: 2 })], couponCode: "MIN5000" }), 5400],
    ["13 entrega no bairro (taxa do bairro)", slug, () => ({ type: "DELIVERY", neighborhoodId: id.centro, items: [item("UN")] }), 3700],
    ["14 bairro com frete grátis acima do mínimo do bairro", slug, () => ({ type: "DELIVERY", neighborhoodId: id.rico, items: [item("UN", { quantity: 2 })] }), 6000],
    ["15 bairro abaixo do mínimo grátis paga a taxa", slug, () => ({ type: "DELIVERY", neighborhoodId: id.rico, items: [item("UN")] }), 3900],
    ["16 gorjeta", slug, () => ({ type: "BALCAO", items: [item("UN")], tipCents: 250 }), 3250],
    ["17 loja com taxa única e frete grátis geral acima do limite", slug2, () => ({ type: "DELIVERY", items: [item("UN2", { quantity: 2 })] }), 4000],
    ["18 taxa única abaixo do limite grátis", slug2, () => ({ type: "DELIVERY", items: [item("UN2")] }), 2600],
    ["19 frete grátis conta o subtotal LÍQUIDO (o cupom derruba abaixo do limite: cobra a taxa)", slug2, () => ({ type: "DELIVERY", items: [item("UN2", { quantity: 2 })], couponCode: "PCT10" }), 3600 + 600],
  ];
  for (const [nome, s, fazer, esperado] of paridade) {
    it(`paridade — ${nome}`, async () => {
      const payload = fazer();
      const q = await quote(s, payload);
      expect(q.statusCode, q.body).toBe(200);
      const quoted = json(q).quote;
      const c = await create(s, payload);
      expect(c.statusCode, c.body).toBe(201);
      const order = await prisma.order.findFirstOrThrow({ where: { id: json(c).orderId } });
      expect(quoted.totalCents).toBe(esperado);
      expect([quoted.subtotalCents, quoted.discountCents, quoted.deliveryFeeCents, quoted.tipCents, quoted.totalCents]).toEqual([order.subtotalCents, order.discountCents, order.deliveryFeeCents, order.tipCents, order.totalCents]);
      expect(quoted.hasUnavailable).toBe(false);
    });
  }

  // Recusas de PEDIDO (mínimo, cupom, bairro): a cotação recusa com o MESMO status e corpo da criação.
  const recusas: Array<[string, string, () => Record<string, unknown>]> = [
    ["20 pedido mínimo da loja", slug2, () => ({ type: "BALCAO", items: [{ productId: id.UN2, quantity: 1 }] })],
    ["21 cupom inexistente", slug, () => ({ type: "BALCAO", items: [item("UN")], couponCode: "NAOEXISTE" })],
    ["22 cupom com mínimo não atingido", slug, () => ({ type: "BALCAO", items: [item("UN")], couponCode: "MIN5000" })],
    ["23 entrega sem escolher o bairro (loja com bairros)", slug, () => ({ type: "DELIVERY", items: [item("UN")] })],
    ["24 bairro de outra loja", slug, () => ({ type: "DELIVERY", neighborhoodId: "bairro-que-nao-existe", items: [item("UN")] })],
  ];
  // o mínimo da loja 2 é 1500 e o prato custa 2000: para recusar de verdade, sobe o mínimo antes do caso
  for (const [nome, s, fazer] of recusas) {
    it(`paridade de recusa — ${nome}`, async () => {
      const payload = fazer();
      if (nome.startsWith("20")) await prisma.store.updateMany({ where: { slug: slug2 }, data: { minOrderCents: 5000 } });
      const q = await quote(s, payload);
      const c = await create(s, payload);
      if (nome.startsWith("20")) await prisma.store.updateMany({ where: { slug: slug2 }, data: { minOrderCents: 1500 } });
      expect(c.statusCode, c.body).toBeGreaterThanOrEqual(400);
      expect([q.statusCode, json(q)]).toEqual([c.statusCode, json(c)]);
    });
  }

  // Itens que NÃO podem ser pedidos: a cotação marca e segue; a criação recusa.
  const indisponiveis: Array<[string, () => Record<string, unknown>, string]> = [
    ["25 produto esgotado", () => item("ESGOTADO"), "ITEM_UNAVAILABLE"],
    ["26 produto pausado", () => item("PAUSADO"), "ITEM_UNAVAILABLE"],
    ["27 adicional que não vende sozinho", () => item("ADICIONAL"), "PRODUCT_ADDON_NOT_SOLD_ALONE"],
    ["28 peso fora da faixa", () => item("KG", { weightGrams: 50 }), "WEIGHT_OUT_OF_RANGE"],
    ["29 produto por peso sem peso", () => item("KG"), "WEIGHT_REQUIRED"],
    ["30 opção obrigatória faltando", () => item("OPCOES"), "OPTION_INVALID"],
  ];
  for (const [nome, fazer, codigo] of indisponiveis) {
    it(`item indisponível — ${nome}: cotação marca available:false e o resto entra no total; a criação recusa`, async () => {
      const payload = { type: "BALCAO", items: [item("UN"), fazer()] };
      const q = await quote(slug, payload);
      expect(q.statusCode, q.body).toBe(200);
      const body = json(q).quote;
      expect(body.hasUnavailable).toBe(true);
      expect(body.items[0]).toMatchObject({ available: true, lineTotalCents: 3000 });
      expect(body.items[1]).toMatchObject({ available: false, code: codigo });
      expect(body.totalCents).toBe(3000); // só o item válido entra na conta
      const c = await create(slug, payload);
      expect(c.statusCode).toBeGreaterThanOrEqual(400);
    });
  }

  it("a cotação NÃO grava: nenhum pedido novo, uso do cupom intacto, nenhum número de pedido gasto", async () => {
    const pedidos = await prisma.order.count();
    const uso = (await prisma.coupon.findFirstOrThrow({ where: { code: "PCT10", store: { slug } } })).usedCount;
    const contador = await prisma.storeCounter.findMany();
    for (let i = 0; i < 5; i++) expect((await quote(slug, { type: "BALCAO", items: [item("UN")], couponCode: "PCT10" })).statusCode).toBe(200);
    expect(await prisma.order.count()).toBe(pedidos);
    expect((await prisma.coupon.findFirstOrThrow({ where: { code: "PCT10", store: { slug } } })).usedCount).toBe(uso);
    expect(await prisma.storeCounter.findMany()).toEqual(contador);
  });

  it("preço esperado: a CRIAÇÃO dá 409 ITEM_PRICE_CHANGED; a cotação ignora o campo e devolve o preço vigente", async () => {
    const item409 = { ...item("PROMO"), expectedUnitPriceCents: 3000 }; // o cliente viu 30,00; a promoção está ativa (24,00)
    const c = await create(slug, { type: "BALCAO", items: [item409] });
    expect([c.statusCode, json(c).code]).toEqual([409, "ITEM_PRICE_CHANGED"]);
    const q = await quote(slug, { type: "BALCAO", items: [item409] });
    expect(q.statusCode, q.body).toBe(200);
    expect(json(q).quote.items[0].unitPriceCents).toBe(2400);
  });

  it("tetos POR LOJA: a 61ª cotação com cupom, de IPs DIFERENTES, na mesma loja = 429; a outra loja não é afetada; sem cupom o teto da loja é 600", async () => {
    const comCupom = (ip: string, s = slug) => app.inject({ method: "POST", url: `/stores/${s}/quote`, remoteAddress: ip, payload: { type: "BALCAO", items: [item("UN")], couponCode: "PCT10" } as never });
    for (let i = 0; i < 60; i++) expect((await comCupom(`10.20.${Math.floor(i / 250)}.${(i % 250) + 1}`)).statusCode, `cotação ${i + 1}`).toBe(200);
    const bloqueada = await comCupom("10.99.0.1");
    expect(bloqueada.statusCode).toBe(429);
    expect(json(bloqueada)).toMatchObject({ code: "RATE_LIMITED" });
    const outraLoja = await app.inject({ method: "POST", url: `/stores/${slug2}/quote`, remoteAddress: "10.99.0.2", payload: { type: "BALCAO", items: [{ productId: id.UN2, quantity: 1 }], couponCode: "PCT10" } as never });
    expect(outraLoja.statusCode, outraLoja.body).toBe(200);
    const semCupom = await app.inject({ method: "POST", url: `/stores/${slug}/quote`, remoteAddress: "10.99.0.3", payload: { type: "BALCAO", items: [item("UN")] } as never });
    expect(semCupom.statusCode).toBe(200); // o teto com cupom não derruba a cotação comum
  });

  it("cotação COM cupom tem teto próprio por IP (20/min): a 21ª leva 429 e a cotação SEM cupom segue livre", async () => {
    let status = 0;
    for (let i = 0; i < 20; i++) status = (await quote(slug, { type: "BALCAO", items: [item("UN")], couponCode: `TENTATIVA${i}` })).statusCode;
    expect(status).toBe(400); // cupom inexistente: o mesmo erro da criação
    const bloqueada = await quote(slug, { type: "BALCAO", items: [item("UN")], couponCode: "PCT10" });
    expect(bloqueada.statusCode).toBe(429);
    expect(json(bloqueada)).not.toHaveProperty("quote");
    expect((await quote(slug, { type: "BALCAO", items: [item("UN")] })).statusCode).toBe(200);
  });

  it("custo constante: 50 itens = UMA consulta de produtos (não uma por item); resposta com Cache-Control: no-store", async () => {
    const original = prisma.product.findMany;
    let chamadas = 0;
    (prisma.product as unknown as { findMany: unknown }).findMany = (...args: Parameters<typeof original>) => {
      chamadas += 1;
      return original.apply(prisma.product, args);
    };
    try {
      const itens = Array.from({ length: 50 }, (_, i) => item(i % 2 === 0 ? "UN" : "PROMO"));
      const r = await quote(slug, { type: "BALCAO", items: itens });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(json(r).quote.items).toHaveLength(50);
      expect(json(r).quote.subtotalCents).toBe(25 * 3000 + 25 * 2400);
    } finally {
      (prisma.product as unknown as { findMany: unknown }).findMany = original;
    }
    expect(chamadas).toBe(1);
  });

  it("regras do PEDIDO TODO dão a mesma resposta nos dois: 7 itens × 30 seleções (210 > 200) = 400 OPTIONS_TOO_MANY na cotação e na criação", async () => {
    const trinta = Array.from({ length: 30 }, () => ({ optionId: id.G, quantity: 1 }));
    const payload = { type: "BALCAO", items: Array.from({ length: 7 }, () => item("OPCOES", { optionSelections: trinta })) };
    const q = await quote(slug, payload);
    const c = await create(slug, payload);
    expect([q.statusCode, json(q)]).toEqual([c.statusCode, json(c)]);
    expect([c.statusCode, json(c).code]).toEqual([400, "OPTIONS_TOO_MANY"]);
  });

  it("cotar NÃO exige loja aberta: loja desligada responde com preço, accepting:false e reason; a CRIAÇÃO é que recusa (409 STORE_CLOSED)", async () => {
    await prisma.store.updateMany({ where: { slug: slug2 }, data: { acceptingOrders: false } });
    try {
      const payload = { type: "BALCAO", items: [{ productId: id.UN2, quantity: 2 }] };
      const q = await quote(slug2, payload);
      expect(q.statusCode, q.body).toBe(200);
      expect(json(q).quote).toMatchObject({ accepting: false, reason: "SWITCHED_OFF", totalCents: 4000 });
      const c = await create(slug2, payload);
      expect([c.statusCode, json(c).code]).toEqual([409, "STORE_CLOSED"]);
    } finally {
      await prisma.store.updateMany({ where: { slug: slug2 }, data: { acceptingOrders: true } });
    }
    expect(json(await quote(slug2, { type: "BALCAO", items: [{ productId: id.UN2, quantity: 1 }] })).quote).toMatchObject({ accepting: true, reason: null });
  });

  it("contrato público: chaves EXATAS da cotação e dos itens; sem dado interno (id de loja, cupom, bairro, custo)", async () => {
    const q = await quote(slug, { type: "DELIVERY", neighborhoodId: id.centro, items: [item("PROMO")], couponCode: "PCT10" });
    const body = json(q).quote;
    expect(Object.keys(body).sort()).toEqual(["accepting", "couponApplied", "deliveryFeeCents", "discountCents", "hasUnavailable", "items", "reason", "subtotalCents", "tipCents", "totalCents"]);
    expect(Object.keys(body.items[0]).sort()).toEqual(["available", "index", "lineTotalCents", "listPriceCents", "productId", "quantity", "unitPriceCents", "weightGrams"]);
    expect(body.couponApplied).toBe(true);
    expect(q.body).not.toContain("storeId");
    expect(q.body).not.toContain("PCT10");
  });

  it("validação e isolamento: corpo inválido 400; mesa 400; loja inexistente 404; produto de OUTRA loja = item indisponível (nunca preço dele); campos de pessoa ignorados", async () => {
    expect((await quote(slug, { type: "BALCAO", items: [] })).statusCode).toBe(400);
    expect((await quote(slug, { type: "MESA", items: [item("UN")] })).statusCode).toBe(400);
    expect((await quote("loja-que-nao-existe", { type: "BALCAO", items: [item("UN")] })).statusCode).toBe(404);
    const alheio = await quote(slug2, { type: "BALCAO", items: [{ productId: id.UN, quantity: 1 }] }); // produto da loja 1 na loja 2
    expect(alheio.statusCode, alheio.body).toBe(200);
    expect(json(alheio).quote.items[0]).toMatchObject({ available: false, code: "PRODUCT_NOT_FOUND" });
    expect(json(alheio).quote.totalCents).toBe(0);
    const comPessoa = await quote(slug, { type: "BALCAO", items: [item("UN")], customerName: "Maria", customerPhone: "11999999999" });
    expect(comPessoa.statusCode).toBe(200); // campos de pessoa não fazem parte da cotação: ignorados, nunca guardados
  });
});
