// API-49 (RN-TXT-01..06, CA-TXT-01..03/05): texto livre limpo na entrada (zod) e de novo no renderizador do tíquete.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { sanitizeText, textField } from "@meucardapio/shared-types";
import { buildPrintableOrder } from "../src/lib/printable";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("sanitizeText / textField (puro)", () => {
  it("CA-TXT-01: BEL, C1, separadores de linha e controles bidirecionais somem; \\n fica; o resto do texto é igual", () => {
    expect(sanitizeText("Sem\u0007 cebola\u202E\u2066 por favor\uFEFF", { multiline: true })).toBe("Sem cebola por favor");
    expect(sanitizeText("a\u0000b\u001Bc\u007Fd\u0085e\u2028f\u2029g")).toBe("abcdefg");
    expect(sanitizeText("linha 1\r\nlinha 2\rlinha 3", { multiline: true })).toBe("linha 1\nlinha 2\nlinha 3");
    expect(sanitizeText("  João  ")).toBe("João");
  });
  it("tab vira espaço; sem multiline a quebra de linha vira espaço (nome, código, rótulo)", () => {
    expect(sanitizeText("a\tb")).toBe("a b");
    expect(sanitizeText("Maria\nSilva")).toBe("Maria Silva");
    expect(sanitizeText("Maria\n\n\nSilva", { multiline: true })).toBe("Maria\n\nSilva");
  });
  it("CA-TXT-03: 'Cafe' + U+0301 vira NFC (1 caractere); emoji é mantido e conta 1", () => {
    const decomposed = "Cafe" + String.fromCharCode(0x301); // e + acento combinante
    expect(sanitizeText(decomposed)).toBe("Caf" + String.fromCharCode(0xe9));
    expect(sanitizeText(decomposed)).toHaveLength(4);
    expect(sanitizeText("Pizza 🍕")).toBe("Pizza 🍕");
    const f = textField({ max: 7 });
    expect(f.safeParse("Pizza 🍕").success).toBe(true); // 7 caracteres visíveis, não 8 unidades UTF-16
  });
  it("limite é RECUSADO com a mensagem do spec, nunca cortado; conta depois da limpeza", () => {
    const f = textField({ max: 5 });
    const bad = f.safeParse("123456");
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].message).toBe("Passou de 5 caracteres.");
    expect(f.parse("12\u000734\u00075")).toBe("12345");
  });
  it("mínimo vale depois da limpeza (só controle = vazio) e multiline limita a 5 linhas", () => {
    expect(textField({ max: 10, min: 1 }).safeParse("\u0007\u200E  ").success).toBe(false);
    expect(textField({ max: 100, multiline: true }).safeParse("1\n2\n3\n4\n5").success).toBe(true);
    expect(textField({ max: 100, multiline: true }).safeParse("1\n2\n3\n4\n5\n6").success).toBe(false);
  });
});

describe("texto livre nas rotas", () => {
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

  async function setup(slug: string, code: string) {
    const { cookie } = await registerStore(app, { slug, code });
    const category = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "Lanches" } })).category;
    const product = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: category.id, name: "Pizza 🍕", priceCents: 1500 } })).product;
    return { cookie: cookie!, slug, productId: product.id as string, categoryId: category.id as string };
  }
  const order = (slug: string, productId: string, body: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 1 }], ...body } });

  it("CA-TXT-01/03: pedido público chega limpo no banco (controle e bidi removidos, NFC, pontas cortadas); emoji do produto fica", async () => {
    const { slug, productId } = await setup("tx-a", "TA1");
    const ctl = (n: number) => String.fromCharCode(n);
    const res = await order(slug, productId, { customerName: "  Jose" + ctl(0x301) + ctl(7) + " " + ctl(0x7f) + "Silva ", notes: "sem" + ctl(7) + " cebola" + ctl(13) + ctl(10) + "obrigado" });
    expect(res.statusCode).toBe(201);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: json(res).orderId } });
    expect(saved.customerName).toBe("Jos" + String.fromCharCode(0xe9) + " Silva");
    expect(saved.notes).toBe("sem cebola\nobrigado");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe("Pizza 🍕");
  });

  it("CA-TXT-02: 301 caracteres na observação => 400 TEXT_TOO_LONG (field, max) e nada gravado; 300 passa", async () => {
    const { slug, productId } = await setup("tx-b", "TB1");
    const refused = await order(slug, productId, { notes: "x".repeat(301) });
    expect(refused.statusCode).toBe(400);
    expect(json(refused).code).toBe("TEXT_TOO_LONG");
    expect(json(refused).details).toEqual({ field: "notes", max: 300 });
    expect(await prisma.order.count()).toBe(0);
    expect((await order(slug, productId, { notes: "x".repeat(300) })).statusCode).toBe(201);
    const name = await order(slug, productId, { customerName: "n".repeat(81) });
    expect(json(name).details).toEqual({ field: "customerName", max: 80 });
  });

  it("painel: nome de produto (80) e de categoria (50) recusam acima do limite; nota interna do pedido limpa e limitada a 500", async () => {
    const { cookie, slug, productId, categoryId } = await setup("tx-c", "TC1");
    const p = await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie }, payload: { categoryId, name: "p".repeat(81), priceCents: 100 } });
    expect(p.statusCode).toBe(400);
    expect(json(p).details).toEqual({ field: "name", max: 80 });
    const c = await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie }, payload: { name: "c".repeat(51) } });
    expect(json(c).details).toEqual({ field: "name", max: 50 });
    const ok = await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie }, payload: { categoryId, name: "Suco\u0007 de laranja", description: "doce\u202E", priceCents: 100 } });
    expect(json(ok).product.name).toBe("Suco de laranja");
    expect(json(ok).product.description).toBe("doce");

    const orderId = json(await order(slug, productId)).orderId as string;
    const note = await app.inject({ method: "POST", url: `/api/orders/${orderId}/internal-note`, headers: { cookie }, payload: { note: "ligar\u0007 antes" } });
    expect(note.statusCode).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).internalNote).toBe("ligar antes");
    const big = await app.inject({ method: "POST", url: `/api/orders/${orderId}/internal-note`, headers: { cookie }, payload: { note: "y".repeat(501) } });
    expect(big.statusCode).toBe(400);
    expect(json(big).code).toBe("NOTE_TOO_LONG"); // contrato da API-70 mantido
  });

  it("corpo 400 que não é de texto longo não ganha o código (ex.: tipo errado, campo obrigatório vazio)", async () => {
    const { slug, productId } = await setup("tx-d", "TD1");
    const wrongType = await order(slug, productId, { notes: 42 });
    expect(wrongType.statusCode).toBe(400);
    expect(json(wrongType).code).toBeUndefined();
    const empty = await order(slug, productId, { customerName: "\u0007  " });
    expect(empty.statusCode).toBe(400);
    expect(json(empty).code).toBeUndefined();
  });

  it("renderizador (D4-6): dado ANTIGO com controle no banco sai limpo no tíquete", async () => {
    const { slug, productId } = await setup("tx-e", "TE1");
    const orderId = json(await order(slug, productId, { customerName: "Ana" })).orderId as string;
    await prisma.order.update({ where: { id: orderId }, data: { customerName: "An\u001Ba\u0007", notes: "corta\u0007 papel\u202E" } });
    await prisma.orderItem.updateMany({ where: { orderId }, data: { productName: "Pizza\u001B🍕", notes: "bem\u0002 passada" } });
    const ticket = (await buildPrintableOrder(orderId))!;
    expect(ticket.customerName).toBe("Ana");
    expect(ticket.notes).toBe("corta papel");
    expect(ticket.items[0].productName).toBe("Pizza🍕");
    expect(ticket.items[0].notes).toBe("bem passada");
    expect(JSON.stringify(ticket)).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F]/);
  });
});
