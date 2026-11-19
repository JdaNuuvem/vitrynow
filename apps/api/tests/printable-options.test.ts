// API-14b — o tíquete lê as OPÇÕES do item (OrderItemOption, API-15): a cozinha vê grupo e escolha, e a conta do tíquete (como o cliente de impressão a faz:
// (unitário + Σ additionals) × quantidade) bate com o total do item. O formato do tíquete NÃO muda (mesmo campo `additionals`, mesma versão).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { TICKET_SCHEMA_VERSION } from "@meucardapio/shared-types";
import { OPTION_GROUP_MAX, OPTION_NAME_MAX, buildPrintableOrder } from "../src/lib/printable";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-14b — tíquete com opções do item", () => {
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

  async function loja() {
    const { response } = await registerStore(app);
    return json(response).store.id as string;
  }
  type Opcao = { groupName: string; name: string; priceCents: number; quantity?: number; priceMode: "BASE" | "SUM" };
  async function pedido(storeId: string, itens: { productName: string; quantity: number; unitPriceCents: number; options?: Opcao[]; additionals?: { name: string; priceCents: number }[] }[], code = "0001") {
    const total = itens.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
    const o = await prisma.order.create({
      data: {
        storeId,
        code,
        type: "BALCAO",
        status: "CONFIRMADO",
        subtotalCents: total,
        totalCents: total,
        paymentMethod: "DEBITO",
        items: {
          create: itens.map((i) => ({
            productName: i.productName,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
            ...(i.options ? { options: { create: i.options.map((o) => ({ quantity: 1, ...o })) } } : {}),
            ...(i.additionals ? { additionals: { create: i.additionals } } : {}),
          })),
        },
      },
    });
    return o.id;
  }
  // a conta que o cliente de impressão faz por item
  const linha = (item: { quantity: number; unitPriceCents: number; additionals: { priceCents: number }[] }) =>
    (item.unitPriceCents + item.additionals.reduce((s, a) => s + a.priceCents, 0)) * item.quantity;

  it("a cozinha vê grupo e escolha de cada opção; BASE sai a R$ 0 (já é a base) e SOMA sai com o extra (preço × quantidade da opção)", async () => {
    const storeId = await loja();
    // Pizza Grande (BASE R$ 40,00) + Borda Catupiry (+R$ 8,00) + Molho Barbecue x3 (+R$ 2,00 cada): unitário do item = 40 + 8 + 6 = R$ 54,00; 2 pizzas
    const id = await pedido(storeId, [
      {
        productName: "Pizza",
        quantity: 2,
        unitPriceCents: 5400,
        options: [
          { groupName: "Tamanho", name: "Grande", priceCents: 4000, priceMode: "BASE" },
          { groupName: "Borda", name: "Catupiry", priceCents: 800, priceMode: "SUM" },
          { groupName: "Molhos", name: "Barbecue", priceCents: 200, quantity: 3, priceMode: "SUM" },
        ],
      },
    ]);
    const t = (await buildPrintableOrder(id))!;
    expect(t.ticketSchemaVersion).toBe(TICKET_SCHEMA_VERSION);
    const item = t.items[0];
    expect(item.unitPriceCents).toBe(4000); // a BASE: o unitário do pedido (R$ 54,00) menos os extras (R$ 14,00)
    expect(item.additionals).toEqual([
      { name: "Tamanho: Grande", priceCents: 0 },
      { name: "Borda: Catupiry", priceCents: 800 },
      { name: "Molhos: Barbecue x3", priceCents: 600 },
    ]);
    expect(linha(item)).toBe(5400 * 2); // sem cobrar a opção em dobro nem deixar de cobrar
  });

  it("item SEM opções continua igual: adicionais antigos e preço unitário intactos; os dois tipos no mesmo pedido convivem", async () => {
    const storeId = await loja();
    const id = await pedido(storeId, [
      { productName: "Lanche", quantity: 1, unitPriceCents: 1500, additionals: [{ name: "Bacon", priceCents: 300 }] },
      { productName: "Pizza", quantity: 1, unitPriceCents: 4800, options: [{ groupName: "Borda", name: "Cheddar", priceCents: 800, priceMode: "SUM" }] },
    ]);
    const t = (await buildPrintableOrder(id))!;
    expect(t.items[0]).toMatchObject({ unitPriceCents: 1500, additionals: [{ name: "Bacon", priceCents: 300 }] });
    expect(t.items[1]).toMatchObject({ unitPriceCents: 4000, additionals: [{ name: "Borda: Cheddar", priceCents: 800 }] });
    expect(linha(t.items[1])).toBe(4800);
  });

  it("2ª via e aviso de cancelamento: a 2ª via traz as opções; o aviso de cancelamento continua SEM itens", async () => {
    const storeId = await loja();
    const id = await pedido(storeId, [{ productName: "Pizza", quantity: 1, unitPriceCents: 4000, options: [{ groupName: "Tamanho", name: "Média", priceCents: 4000, priceMode: "BASE" }] }]);
    const segunda = (await buildPrintableOrder(id, { reprintCount: 1, printedAtOriginal: new Date() }))!;
    expect(segunda.items[0].additionals).toEqual([{ name: "Tamanho: Média", priceCents: 0 }]);
    const aviso = (await buildPrintableOrder(id, { cancelNotice: true, printedAtOriginal: new Date() }))!;
    expect(aviso.items).toEqual([]);
  });

  it("(Nightingale 1) grupo e opção de tamanho MÁXIMO (200 caracteres, emoji): o tíquete sai com corte seguro, nunca erro; cabe na largura", async () => {
    const storeId = await loja();
    const id = await pedido(storeId, [{ productName: "Pizza", quantity: 1, unitPriceCents: 4000, options: [{ groupName: "G".repeat(200), name: "\u{1F600}".repeat(200), quantity: 12, priceCents: 0, priceMode: "SUM" }] }]);
    const t = (await buildPrintableOrder(id))!;
    const nome = t.items[0].additionals[0].name;
    expect(Array.from(nome).length).toBeLessThanOrEqual(OPTION_GROUP_MAX + 2 + OPTION_NAME_MAX + 4);
    expect(nome.endsWith(" x12")).toBe(true); // a quantidade não é cortada
    expect(nome).toContain("\u2026");
    // nenhum par substituto partido: todo emoji que sobrou está inteiro
    expect(Array.from(nome).every((c) => c.codePointAt(0)! < 0xd800 || c.codePointAt(0)! > 0xdfff)).toBe(true);
  });

  it("(Nightingale 2) item antigo inconsistente (extras maiores que o unitário): o unitário do tíquete NUNCA fica negativo", async () => {
    const storeId = await loja();
    const id = await pedido(storeId, [{ productName: "Pizza", quantity: 1, unitPriceCents: 500, options: [{ groupName: "Borda", name: "Cheddar", priceCents: 800, priceMode: "SUM" }] }]);
    const t = (await buildPrintableOrder(id))!;
    expect(t.items[0].unitPriceCents).toBe(0);
  });

  it("texto da opção passa pela sanitização do tíquete (sem byte de comando) e nada de outra loja entra", async () => {
    const a = await loja();
    const b = await loja();
    const idA = await pedido(a, [{ productName: "Pizza", quantity: 1, unitPriceCents: 4000, options: [{ groupName: "Borda\u001b[2J", name: "Cat\u0007upiry", priceCents: 0, priceMode: "SUM" }] }], "0001");
    await pedido(b, [{ productName: "Outro", quantity: 1, unitPriceCents: 100, options: [{ groupName: "G", name: "Segredo-da-loja-B", priceCents: 0, priceMode: "SUM" }] }], "0001");
    const t = (await buildPrintableOrder(idA))!;
    const nome = t.items[0].additionals[0].name;
    expect(nome).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
    expect(JSON.stringify(t)).not.toContain("Segredo-da-loja-B");
  });
});
