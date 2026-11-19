// API-15 parte 2 (B8): a COSTURA do pedido público com os grupos de opções. O servidor é a única fonte do preço (RN-B8-03); a escolha vira
// cópia no pedido (RN-B8-07); opção de outra loja/produto/inativa é recusada com a MESMA resposta (RN-B8-02, sem oráculo); produto sem grupo
// real segue o caminho legado dos adicionais com o preço idêntico ao de antes (CA-B8-06).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("pedido com grupos de opções (API-15 parte 2)", () => {
  let app: ReturnType<typeof makeApp>;
  let seq = 0;
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

  const json = (r: { body: string }) => JSON.parse(r.body);

  async function loja() {
    seq += 1;
    const slug = `opc-${seq}-${Date.now() % 100000}`;
    const { cookie, response } = await registerStore(app, { slug, code: `OO${seq}`, pix: false });
    const storeId = json(response).store.id as string;
    const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie: cookie! }, payload: payload as never });
    const categoryId = json(await post("/api/catalog/categories", { name: "Pizzas" })).category.id as string;
    const group = async (input: unknown) => json(await post("/api/catalog/option-groups", input)).group as { id: string; options: Array<{ id: string; name: string }> };
    const product = async (name: string, priceCents: number) => json(await post("/api/catalog/products", { categoryId, name, priceCents })).product.id as string;
    const link = (productId: string, groupIds: string[]) => post(`/api/catalog/products/${productId}/option-groups`, { groupIds });
    return { cookie: cookie!, storeId, slug, post, group, product, link };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  const tamanho = { name: "Tamanho", minSelect: 1, maxSelect: 1, maxPerOption: 1, priceMode: "BASE", options: [{ name: "P", priceCents: 3000 }, { name: "M", priceCents: 4500 }, { name: "G", priceCents: 6000 }] };
  const borda = { name: "Borda", minSelect: 0, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", options: [{ name: "Catupiry", priceCents: 800 }] };
  const extra = { name: "Extras", minSelect: 0, maxSelect: 3, maxPerOption: 2, priceMode: "SUM", options: [{ name: "Bacon", priceCents: 500 }, { name: "Ovo", priceCents: 300 }] };

  const pedido = (l: Loja, items: unknown[]) =>
    app.inject({ method: "POST", url: `/stores/${l.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items } });

  async function pizzaria(l: Loja) {
    const t = await l.group(tamanho);
    const b = await l.group(borda);
    const e = await l.group(extra);
    const pizza = await l.product("Pizza", 5000);
    expect((await l.link(pizza, [t.id, b.id, e.id])).statusCode).toBe(200);
    return { t, b, e, pizza };
  }

  it("preço da linha = variação (BASE) + Σ opções × quantidade; o servidor decide e o total do pedido bate", async () => {
    const l = await loja();
    const { t, b, e, pizza } = await pizzaria(l);
    const optId = (g: typeof t, name: string) => g.options.find((o) => o.name === name)!.id;
    const res = await pedido(l, [
      { productId: pizza, quantity: 2, options: [{ optionId: optId(t, "G") }, { optionId: optId(b, "Catupiry") }, { optionId: optId(e, "Bacon"), quantity: 2 }] },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: json(res).orderId }, include: { items: { include: { options: true } } } });
    // unidade = 6000 (G) + 800 (borda) + 2×500 (bacon) = 7800; 2 pizzas = 15600
    expect(order.items[0].unitPriceCents).toBe(7800);
    expect(order.subtotalCents).toBe(15600);
    expect(order.totalCents).toBe(15600);
    // cópia gravada (RN-B8-07): grupo, nome, preço, quantidade e modo
    const copias = order.items[0].options.map((o) => ({ g: o.groupName, n: o.name, p: o.priceCents, q: o.quantity, m: o.priceMode })).sort((x, y) => x.n.localeCompare(y.n));
    expect(copias).toEqual([
      { g: "Extras", n: "Bacon", p: 500, q: 2, m: "SUM" },
      { g: "Borda", n: "Catupiry", p: 800, q: 1, m: "SUM" },
      { g: "Tamanho", n: "G", p: 6000, q: 1, m: "BASE" },
    ]);
  });

  it("mudar o cardápio DEPOIS não altera o pedido antigo (cópia imutável)", async () => {
    const l = await loja();
    const { t, pizza } = await pizzaria(l);
    const res = await pedido(l, [{ productId: pizza, quantity: 1, options: [{ optionId: t.options.find((o) => o.name === "M")!.id }] }]);
    expect(res.statusCode, res.body).toBe(201);
    await prisma.option.update({ where: { id: t.options.find((o) => o.name === "M")!.id }, data: { priceCents: 9999, name: "Médio" } });
    const copia = await prisma.orderItemOption.findFirstOrThrow({ where: { orderItem: { orderId: json(res).orderId } } });
    expect({ n: copia.name, p: copia.priceCents }).toEqual({ n: "M", p: 4500 });
  });

  it("regras do grupo valem no pedido: obrigatório ausente, acima do máximo e quantidade por opção ⇒ 400 com `code` e `issues`; nada é gravado", async () => {
    const l = await loja();
    const { t, e, pizza } = await pizzaria(l);
    const g = t.options.find((o) => o.name === "G")!.id;
    const bacon = e.options.find((o) => o.name === "Bacon")!.id;
    const ovo = e.options.find((o) => o.name === "Ovo")!.id;
    const casos: Array<[string, unknown[]]> = [
      ["OPTION_REQUIRED", []], // Tamanho é obrigatório (BASE)
      ["OPTION_MAX_EXCEEDED", [{ optionId: g }, { optionId: bacon, quantity: 2 }, { optionId: ovo, quantity: 2 }]], // 4 extras > 3
      ["OPTION_PER_OPTION_MAX", [{ optionId: g }, { optionId: bacon, quantity: 3 }]], // até 2 de cada
      ["OPTION_DUPLICATE", [{ optionId: g }, { optionId: g }]],
    ];
    for (const [code, options] of casos) {
      const res = await pedido(l, [{ productId: pizza, quantity: 1, options }]);
      expect(res.statusCode, code).toBe(400);
      expect(json(res)).toMatchObject({ code: "OPTION_INVALID" });
      expect(json(res).issues.map((i: { code: string }) => i.code), code).toContain(code);
    }
    expect(await prisma.order.count({ where: { storeId: l.storeId } })).toBe(0);
  });

  it("opção de OUTRA loja, de OUTRO produto, inativa ou inexistente: a MESMA resposta (sem oráculo) e nada é gravado", async () => {
    const a = await loja();
    const b = await loja();
    const { t: tA, pizza } = await pizzaria(a);
    const { t: tB } = await pizzaria(b); // opções da loja B
    const outroProduto = await a.product("Refri", 800);
    const grupoSoDoRefri = await a.group({ name: "Gelo", minSelect: 0, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", options: [{ name: "Com gelo", priceCents: 0 }] });
    expect((await a.link(outroProduto, [grupoSoDoRefri.id])).statusCode).toBe(200);
    const inativa = await a.group({ name: "Molho", minSelect: 0, maxSelect: 1, maxPerOption: 1, priceMode: "SUM", options: [{ name: "Alho", priceCents: 100, active: false }] });
    await prisma.productOptionGroup.create({ data: { storeId: a.storeId, productId: pizza, groupId: inativa.id, position: 9 } });
    const tamanhoOk = { optionId: tA.options.find((o) => o.name === "P")!.id };

    const ruins = {
      deOutraLoja: tB.options[0].id,
      deOutroProduto: grupoSoDoRefri.options[0].id,
      inativa: inativa.options[0].id,
      inexistente: "opcao-que-nao-existe",
    };
    const corpos = new Set<string>();
    for (const [rotulo, optionId] of Object.entries(ruins)) {
      const res = await pedido(a, [{ productId: pizza, quantity: 1, options: [tamanhoOk, { optionId }] }]);
      expect(res.statusCode, rotulo).toBe(400);
      expect(json(res).code, rotulo).toBe("OPTION_INVALID");
      expect(json(res).issues.map((i: { code: string }) => i.code), rotulo).toEqual(["OPTION_NOT_FOUND"]);
      // a mensagem não cita a opção alheia nem diz que ela existe em outro lugar
      expect(res.body, rotulo).not.toMatch(/Gelo|Alho|loja B|outra loja/);
      corpos.add(JSON.stringify(json(res).issues.map((i: { code: string; message: string }) => ({ code: i.code, message: i.message }))));
    }
    expect(corpos.size, "as 4 recusas têm exatamente a mesma resposta").toBe(1);
    expect(await prisma.order.count({ where: { storeId: a.storeId } })).toBe(0);
    expect(await prisma.order.count({ where: { storeId: b.storeId } })).toBe(0);
  });

  it("isolamento entre lojas: o pedido da loja A com uma opção da B não cria nada na B e a B nunca vê cópia de A", async () => {
    const a = await loja();
    const b = await loja();
    const { pizza } = await pizzaria(a);
    const { t: tB } = await pizzaria(b);
    await pedido(a, [{ productId: pizza, quantity: 1, options: [{ optionId: tB.options[0].id }] }]);
    expect(await prisma.orderItemOption.count()).toBe(0);
  });

  it("`options` e `additionalIds` no mesmo item: adicional inexistente ⇒ 400; o MESMO id como opção e como adicional ⇒ 400 OPTIONS_AMBIGUOUS (não cobra em dobro)", async () => {
    const l = await loja();
    const { t, pizza } = await pizzaria(l);
    const res = await pedido(l, [{ productId: pizza, quantity: 1, options: [{ optionId: t.options[0].id }], additionalIds: ["x"] }]);
    expect(res.statusCode).toBe(400);
    expect(json(res).code).toBe("ADDITIONAL_NOT_FOUND");
    const adicional = await prisma.productAdditional.create({ data: { productId: pizza, name: "Ovo", priceCents: 300 } });
    const dobro = await pedido(l, [{ productId: pizza, quantity: 1, options: [{ optionId: t.options[0].id }, { optionId: adicional.id }], additionalIds: [adicional.id] }]);
    expect(dobro.statusCode).toBe(400);
    expect(json(dobro).code).toBe("OPTIONS_AMBIGUOUS");
  });

  it("CA-B8-06: produto SÓ com adicionais antigos segue o caminho legado com o MESMO preço (e aceita `options` pelos mesmos ids)", async () => {
    const l = await loja();
    const produto = await l.product("Lanche", 2000);
    const adicional = await prisma.productAdditional.create({ data: { productId: produto, name: "Queijo", priceCents: 350 } });
    const legado = await pedido(l, [{ productId: produto, quantity: 2, additionalIds: [adicional.id] }]);
    expect(legado.statusCode, legado.body).toBe(201);
    const pedidoLegado = await prisma.order.findUniqueOrThrow({ where: { id: json(legado).orderId }, include: { items: { include: { additionals: true, options: true } } } });
    expect(pedidoLegado.subtotalCents).toBe((2000 + 350) * 2);
    expect(pedidoLegado.items[0].additionals.map((x) => x.name)).toEqual(["Queijo"]);
    expect(pedidoLegado.items[0].options).toHaveLength(0);
  });

  it("produto ANTIGO (com o espelho LEGACY_ADDITIONALS da migração): `additionalIds` segue o caminho legado (sem cópia de opção, mesmo preço); `options` com os MESMOS ids dá o mesmo preço", async () => {
    const l = await loja();
    const produto = await l.product("Lanche antigo", 2000);
    const adicional = await prisma.productAdditional.create({ data: { productId: produto, name: "Queijo", priceCents: 350 } });
    // o que a migração 350000 faz: um grupo LEGACY_ADDITIONALS por produto, com as opções de MESMO id dos adicionais
    await prisma.optionGroup.create({
      data: { id: `og_leg_${produto}`, storeId: l.storeId, name: "Adicionais", minSelect: 0, maxSelect: null, maxPerOption: 1, priceMode: "SUM", source: "LEGACY_ADDITIONALS", options: { create: [{ id: adicional.id, name: "Queijo", priceCents: 350, position: 0 }] } },
    });
    await prisma.productOptionGroup.create({ data: { storeId: l.storeId, productId: produto, groupId: `og_leg_${produto}`, position: 0 } });

    const legado = await pedido(l, [{ productId: produto, quantity: 2, additionalIds: [adicional.id] }]);
    expect(legado.statusCode, legado.body).toBe(201);
    const a = await prisma.order.findUniqueOrThrow({ where: { id: json(legado).orderId }, include: { items: { include: { additionals: true, options: true } } } });
    expect(a.subtotalCents).toBe((2000 + 350) * 2);
    expect(a.items[0].additionals.map((x) => x.name)).toEqual(["Queijo"]); // caminho LEGADO: o adicional antigo é gravado como sempre
    expect(a.items[0].options).toHaveLength(0); // e NENHUMA cópia de opção (o espelho não vira grupo real)

    const novo = await pedido(l, [{ productId: produto, quantity: 2, options: [{ optionId: adicional.id }] }]);
    expect(novo.statusCode, novo.body).toBe(201);
    const b = await prisma.order.findUniqueOrThrow({ where: { id: json(novo).orderId }, include: { items: { include: { options: true } } } });
    expect(b.subtotalCents).toBe(a.subtotalCents); // CA-B8-06: mesmo preço pelos mesmos ids
    expect(b.items[0].options.map((x) => x.name)).toEqual(["Queijo"]);
  });

  it("produto SEM grupos e sem opções: preço do produto, sem cópia (nenhuma mudança para quem não usa B8)", async () => {
    const l = await loja();
    const produto = await l.product("Água", 600);
    const res = await pedido(l, [{ productId: produto, quantity: 3 }]);
    expect(res.statusCode, res.body).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: json(res).orderId }, include: { items: { include: { options: true } } } });
    expect(order.subtotalCents).toBe(1800);
    expect(order.items[0].options).toHaveLength(0);
  });
});
