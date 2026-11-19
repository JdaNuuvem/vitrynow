// PD / RN-PD-22 (CA-PD-11): relatório de produto por PESO: pedidos (1 por linha, nunca gramas como unidades), kg vendidos (3 casas) e receita; CSV com a coluna de peso.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { kgText } from "../src/lib/reports";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("kgText", () => {
  it("1250 g = 1,250; 400 g = 0,400; 12 g = 0,012; produto sem peso = vazio", () => {
    expect(kgText(1250)).toBe("1,250");
    expect(kgText(400)).toBe("0,400");
    expect(kgText(12)).toBe("0,012");
    expect(kgText(0)).toBe("");
  });
});

describe("relatório por peso (HTTP)", { timeout: 90_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  const slug = "loja-rw";
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    cookie = (await registerStore(app, { slug, code: "RW1" })).cookie!;
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

  it("3 pedidos de 400 g, 350 g e 500 g a R$ 49,90/kg: 3 pedidos, 1,250 kg, receita somada (1.996 + 1.747 + 2.495 = 6.238 centavos); produto por unidade não ganha peso", async () => {
    const cat = json(await post("/api/catalog/categories", { name: "Pratos" })).category.id as string;
    const quilo = json(await post("/api/catalog/products", { categoryId: cat, name: "Feijoada", priceCents: 4990, saleUnit: "KG" })).product.id as string;
    const un = json(await post("/api/catalog/products", { categoryId: cat, name: "Suco", priceCents: 800 })).product.id as string;
    for (const g of [400, 350, 500]) {
      const r = await app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: quilo, quantity: 1, weightGrams: g }] } });
      expect(r.statusCode, r.body).toBe(201);
    }
    expect((await app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: un, quantity: 2 }] } })).statusCode).toBe(201);
    await prisma.order.updateMany({ data: { status: "CONCLUIDO" } }); // contam como venda no relatório
    const hoje = new Date().toISOString().slice(0, 10);
    const dia = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const relatorio = json(await app.inject({ method: "GET", url: `/api/reports/summary?from=${dia}&to=${hoje}`, headers: { cookie } }));
    const feijoada = relatorio.topProducts.find((p: { productName: string }) => p.productName === "Feijoada");
    const suco = relatorio.topProducts.find((p: { productName: string }) => p.productName === "Suco");
    expect(feijoada).toMatchObject({ quantity: 3, weightGrams: 1250, revenueCents: 1996 + 1747 + 2495 });
    expect(suco).toMatchObject({ quantity: 2, weightGrams: 0, revenueCents: 1600 });
    const csv = (await app.inject({ method: "GET", url: `/api/reports/export.csv?from=${dia}&to=${hoje}&table=topProducts`, headers: { cookie } })).body.slice(1).split(String.fromCharCode(13, 10));
    expect(csv[0]).toBe("Produto;Quantidade;Receita com opções (R$);Peso vendido (kg)");
    expect(csv).toContain("Feijoada;3;62,38;1,250"); // "1.250 unidades" nunca: 3 pedidos e 1,250 kg
    expect(csv).toContain("Suco;2;16,00;");
  });
});
