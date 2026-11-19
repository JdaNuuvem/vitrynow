// C1 / CA-B8-CRUZ (Nightingale, Leonardo, Atlas) — UMA convenção de preço do item, provada de ponta a ponta com o que a main FAZ:
//  (a) item com OPÇÕES: `unitPriceCents` = BASE + opções SOMA × quantidade da opção;
//  (b) item com ADICIONAL LEGADO: `unitPriceCents` = SÓ a base e o adicional soma POR CIMA: linha = (unitário + adicionais) × quantidade.
//  (e) DECISÃO do Atlas (#135): opções e adicional legado PODEM coexistir no mesmo item; unitário = base + opções; o adicional soma por cima (exemplo ORIGINAL do Leonardo: 7.900).
// O mesmo pedido tem de dar o MESMO dinheiro no total do pedido, no tíquete (conta do print-client), no relatório e no caixa.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { buildPrintableOrder } from "../src/lib/printable";
import { storeToday } from "../src/lib/storeDay";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("C1 — convenção do preço do item: total, tíquete, relatório e caixa batem", () => {
  let app: ReturnType<typeof makeApp>;
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

  type Caso = { nome: string; unitario: number; qtd: number; linha: number; opcoes?: { groupName: string; name: string; priceCents: number; quantity: number; priceMode: "BASE" | "SUM" }[]; adicional?: { name: string; priceCents: number } };
  const CASOS: Caso[] = [
    {
      // BASE R$ 30,00 + opções R$ 4,00 e R$ 2,50, 2 unidades ⇒ unitário R$ 36,50; linha R$ 73,00
      nome: "(a) variação BASE + 2 opções SOMA",
      unitario: 3650,
      qtd: 2,
      linha: 7300,
      opcoes: [
        { groupName: "Tamanho", name: "Média", priceCents: 3000, quantity: 1, priceMode: "BASE" },
        { groupName: "Borda", name: "Catupiry", priceCents: 400, quantity: 1, priceMode: "SUM" },
        { groupName: "Extra", name: "Bacon", priceCents: 250, quantity: 1, priceMode: "SUM" },
      ],
    },
    // BASE R$ 30,00 + adicional legado R$ 3,00, 2 unidades ⇒ unitário R$ 30,00; linha R$ 66,00
    { nome: "(b) adicional legado", unitario: 3000, qtd: 2, linha: 6600, adicional: { name: "Queijo extra", priceCents: 300 } },
    // (e) BASE 30,00 + opções 4,00 e 2,50 + adicional legado 3,00, 2 unidades ⇒ unitário 36,50; linha (36,50 + 3,00) × 2 = 79,00
    {
      nome: "(e) opções + adicional legado no MESMO item",
      unitario: 3650,
      qtd: 2,
      linha: 7900,
      opcoes: [
        { groupName: "Tamanho", name: "Média", priceCents: 3000, quantity: 1, priceMode: "BASE" },
        { groupName: "Borda", name: "Catupiry", priceCents: 400, quantity: 1, priceMode: "SUM" },
        { groupName: "Extra", name: "Bacon", priceCents: 250, quantity: 1, priceMode: "SUM" },
      ],
      adicional: { name: "Queijo extra", priceCents: 300 },
    },
    // com quantidade na opção: BASE 30,00 + opção 2,00 × 3 = unitário 36,00; 1 unidade
    {
      nome: "(c) opção com quantidade 3",
      unitario: 3600,
      qtd: 1,
      linha: 3600,
      opcoes: [
        { groupName: "Tamanho", name: "Média", priceCents: 3000, quantity: 1, priceMode: "BASE" },
        { groupName: "Molhos", name: "Barbecue", priceCents: 200, quantity: 3, priceMode: "SUM" },
      ],
    },
  ];

  async function cenario(c: Caso, paymentMethod: "DINHEIRO" | "PIX") {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const order = await prisma.order.create({
      data: {
        storeId,
        code: "0001",
        type: "BALCAO",
        status: "CONFIRMADO",
        subtotalCents: c.linha,
        totalCents: c.linha,
        paymentMethod,
        paidAt: paymentMethod === "DINHEIRO" ? new Date() : null,
        items: {
          create: [
            {
              productName: "Pizza",
              quantity: c.qtd,
              unitPriceCents: c.unitario,
              ...(c.opcoes ? { options: { create: c.opcoes } } : {}),
              ...(c.adicional ? { additionals: { create: [c.adicional] } } : {}),
            },
          ],
        },
      },
    });
    return { cookie: cookie!, orderId: order.id, createdAt: order.createdAt };
  }
  // a conta do print-client por item: (unitário + Σ additionals) × quantidade
  const contaDoCliente = (items: { quantity: number; unitPriceCents: number; additionals: { priceCents: number }[] }[]) =>
    items.reduce((s, i) => s + (i.unitPriceCents + i.additionals.reduce((a, x) => a + x.priceCents, 0)) * i.quantity, 0);

  it.each(CASOS)("tíquete, relatório e total do pedido dão o MESMO valor: $nome", async (caso) => {
    const c = await cenario(caso, "PIX");
    const ticket = (await buildPrintableOrder(c.orderId))!;
    expect(ticket.totalCents).toBe(caso.linha);
    expect(contaDoCliente(ticket.items)).toBe(caso.linha); // o cliente de impressão fecha com o total do pedido (sem cobrar em dobro)
    const dia = storeToday(c.createdAt);
    const rep = json(await app.inject({ method: "GET", url: `/api/reports/summary?from=${dia}&to=${dia}`, headers: { cookie: c.cookie } }));
    expect(rep.revenueCents).toBe(caso.linha); // faturamento (sem gorjeta)
    expect(rep.topProducts).toEqual([{ productName: "Pizza", quantity: caso.qtd, revenueCents: caso.linha }]); // receita por produto COM as opções ou o adicional, uma vez só
  });

  it.each(CASOS)("caixa: o mesmo pedido pago em dinheiro soma o MESMO valor no esperado: $nome", async (caso) => {
    const c = await cenario(caso, "DINHEIRO");
    expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: c.cookie }, payload: { openingBalanceCents: 10000 } })).statusCode).toBe(201);
    await prisma.order.update({ where: { id: c.orderId }, data: { paidAt: new Date() } }); // recebido DENTRO da sessão
    const caixa = json(await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: c.cookie } }));
    expect(caixa.expectedBalanceCents).toBe(10000 + caso.linha);
  });

  it("os dois tipos no MESMO pedido (itens diferentes): tudo continua batendo", async () => {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const [a, b] = [CASOS[0], CASOS[1]];
    const order = await prisma.order.create({
      data: {
        storeId,
        code: "0002",
        type: "BALCAO",
        status: "CONFIRMADO",
        subtotalCents: a.linha + b.linha,
        totalCents: a.linha + b.linha,
        paymentMethod: "PIX",
        items: {
          create: [
            { productName: "Pizza A", quantity: a.qtd, unitPriceCents: a.unitario, options: { create: a.opcoes! } },
            { productName: "Pizza B", quantity: b.qtd, unitPriceCents: b.unitario, additionals: { create: [b.adicional!] } },
          ],
        },
      },
    });
    const ticket = (await buildPrintableOrder(order.id))!;
    expect(contaDoCliente(ticket.items)).toBe(a.linha + b.linha);
    const dia = storeToday(order.createdAt);
    const rep = json(await app.inject({ method: "GET", url: `/api/reports/summary?from=${dia}&to=${dia}`, headers: { cookie: cookie! } }));
    expect(rep.revenueCents).toBe(a.linha + b.linha);
    expect(rep.topProducts.reduce((s: number, p: { revenueCents: number }) => s + p.revenueCents, 0)).toBe(a.linha + b.linha);
  });
});
