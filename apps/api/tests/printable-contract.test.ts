// API-14 — contrato do tíquete (ADR-0004 §6/§7). O print-client do Ritchie já consome estes campos.
// Regra de ouro: "NÃO COBRAR" só com paymentStatus = PAGO, e a API só emite PAGO com pagamento APROVADO verificado.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import type { PaymentStatus } from "@meucardapio/db";
import { printableOrderSchema, TICKET_SCHEMA_VERSION } from "@meucardapio/shared-types";
import { buildPrintableOrder, ticketPaymentStatus } from "../src/lib/printable";
import { makeApp, registerStore, resetDb } from "./helpers";

const ALL_PAYMENT_STATUSES: PaymentStatus[] = [
  "PENDENTE",
  "EM_ANALISE",
  "APROVADO",
  "REJEITADO",
  "CANCELADO",
  "EXPIRADO",
  "ESTORNO_PENDENTE",
  "REEMBOLSADO",
  "CONTESTADO",
];

describe("ticketPaymentStatus (puro)", () => {
  it("só APROVADO vira PAGO; REEMBOLSADO vira ESTORNADO; todo o resto A_COBRAR (inclui EM_ANALISE, PENDENTE, ESTORNO_PENDENTE, CONTESTADO)", () => {
    const esperado: Record<PaymentStatus, string> = {
      PENDENTE: "A_COBRAR",
      EM_ANALISE: "A_COBRAR",
      APROVADO: "PAGO",
      REJEITADO: "A_COBRAR",
      CANCELADO: "A_COBRAR",
      EXPIRADO: "A_COBRAR",
      ESTORNO_PENDENTE: "A_COBRAR",
      REEMBOLSADO: "ESTORNADO",
      CONTESTADO: "A_COBRAR",
    };
    for (const status of ALL_PAYMENT_STATUSES) expect(ticketPaymentStatus({ status }), status).toBe(esperado[status]);
    expect(ALL_PAYMENT_STATUSES.filter((s) => ticketPaymentStatus({ status: s }) === "PAGO")).toEqual(["APROVADO"]);
  });
  it("sem registro de pagamento (dinheiro, cartão, PIX presencial do pedido manual) nunca é PAGO", () => {
    expect(ticketPaymentStatus(null)).toBe("A_COBRAR");
    expect(ticketPaymentStatus(undefined)).toBe("A_COBRAR");
  });
});

describe("API-14 — payload do tíquete", () => {
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

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const mk = async (name: string, priceCents: number) =>
      json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie!, }, payload: { categoryId: cat, name, priceCents, additionals: [{ name: "Bacon", priceCents: 300 }] } })).product as { id: string; additionals: { id: string }[] };
    return { cookie: cookie!, storeId: storeId as string, slug: slug as string, product: await mk("Combo", 1500) };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const place = async (ctx: Ctx, extra: Record<string, unknown> = {}) => {
    const res = await app.inject({
      method: "POST",
      url: `/stores/${ctx.slug}/orders`,
      payload: { type: "BALCAO", items: [{ productId: ctx.product.id, quantity: 2, additionalIds: [ctx.product.additionals[0].id] }], ...extra },
    });
    expect(res.statusCode, res.body).toBe(201);
    return json(res).orderId as string;
  };

  it("traz o contrato completo e valida no schema: versão, subtotal/desconto/cupom, troco, status de pagamento e flags", async () => {
    const ctx = await setup();
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.cookie }, payload: { code: "DEZ", discountType: "FIXED", discountValue: 500 } });
    const id = await place(ctx, { couponCode: "DEZ", paymentMethod: "DINHEIRO", changeForCents: 10_000 });
    const t = (await buildPrintableOrder(id))!;
    expect(printableOrderSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({
      ticketSchemaVersion: TICKET_SCHEMA_VERSION,
      subtotalCents: 3600, // (1500 + 300) × 2
      discountCents: 500,
      couponCode: "DEZ",
      totalCents: 3100,
      changeForCents: 10_000,
      paymentMethod: "DINHEIRO",
      paymentStatus: "A_COBRAR",
      tableLabel: null,
      reprintCount: 0,
      printedAtOriginal: null,
      cancelNotice: false,
    });
    // O valor da linha fecha com o subtotal (conta que o Leonardo conferiu nos golden do Ritchie).
    const soma = t.items.reduce((acc, i) => acc + (i.unitPriceCents + i.additionals.reduce((a, x) => a + x.priceCents, 0)) * i.quantity, 0);
    expect(soma).toBe(t.subtotalCents);
  });

  it("sem cupom e sem troco os campos vêm nulos/zerados (não ausentes)", async () => {
    const ctx = await setup();
    const t = (await buildPrintableOrder(await place(ctx)))!;
    expect(t).toMatchObject({ couponCode: null, discountCents: 0, changeForCents: null });
  });

  it("CONTRATO por estado do pagamento: cada status de pagamento real produz o paymentStatus esperado, e só APROVADO vira PAGO", async () => {
    const ctx = await setup();
    const esperado: Record<string, string> = { APROVADO: "PAGO", REEMBOLSADO: "ESTORNADO" };
    for (const status of ALL_PAYMENT_STATUSES) {
      const id = await place(ctx, { paymentMethod: "DINHEIRO" });
      await prisma.order.update({ where: { id }, data: { paymentMethod: "PIX" } });
      await prisma.payment.create({ data: { orderId: id, providerPaymentId: `mp-${id}`, amountCents: 3600, status } });
      const t = (await buildPrintableOrder(id))!;
      expect(t.paymentStatus, status).toBe(esperado[status] ?? "A_COBRAR");
    }
  });

  it("pedido manual/presencial com paymentMethod=PIX e SEM registro de pagamento NUNCA vira PAGO", async () => {
    const ctx = await setup();
    const id = await place(ctx, { paymentMethod: "DINHEIRO" });
    await prisma.order.update({ where: { id }, data: { paymentMethod: "PIX", awaitingPayment: false } });
    const t = (await buildPrintableOrder(id))!;
    expect(t.paymentMethod).toBe("PIX");
    expect(t.paymentStatus).toBe("A_COBRAR");
  });

  it("PIX online pago pelo webhook verificado vira PAGO; o mesmo pedido estornado vira ESTORNADO", async () => {
    const ctx = await setup();
    const id = await place(ctx);
    await prisma.order.update({ where: { id }, data: { paymentMethod: "PIX" } });
    const pay = await prisma.payment.create({ data: { orderId: id, providerPaymentId: "mp-x", amountCents: 3600, status: "APROVADO" } });
    expect((await buildPrintableOrder(id))!.paymentStatus).toBe("PAGO");
    await prisma.payment.update({ where: { id: pay.id }, data: { status: "REEMBOLSADO" } });
    expect((await buildPrintableOrder(id))!.paymentStatus).toBe("ESTORNADO");
  });

  it("endereço só para entrega; retirada e mesa não levam endereço mesmo que o dado exista no pedido", async () => {
    const ctx = await setup();
    const entrega = await place(ctx, { type: "DELIVERY", address: "Rua A, 1", customerPhone: "11999999999", customerName: "Ana" });
    expect((await buildPrintableOrder(entrega))!.address).toBe("Rua A, 1");
    const retirada = await place(ctx, {});
    await prisma.order.update({ where: { id: retirada }, data: { address: "Rua B, 2 (sobrou de edição)" } });
    expect((await buildPrintableOrder(retirada))!.address).toBeNull();
    await prisma.order.update({ where: { id: retirada }, data: { type: "MESA" } });
    expect((await buildPrintableOrder(retirada))!.address).toBeNull();
  });

  it("nunca expõe token, QR do PIX, id do provedor, e-mail nem dados da conta (varredura do JSON inteiro)", async () => {
    const ctx = await setup();
    const id = await place(ctx);
    await prisma.order.update({ where: { id }, data: { paymentMethod: "PIX" } });
    await prisma.payment.create({
      data: { orderId: id, providerPaymentId: "mp-segredo-123", amountCents: 3600, status: "APROVADO", pixQrCode: "00020126-copia-e-cola-SEGREDO", pixQrCodeBase64: "QVFSQ09ERQ==", idempotencyKey: "chave-idem-SEGREDO" },
    });
    const dump = JSON.stringify(await buildPrintableOrder(id));
    for (const proibido of ["mp-segredo-123", "SEGREDO", "QVFSQ09ERQ", "providerPaymentId", "pixQr", "idempotency", "token", "@"]) {
      expect(dump, proibido).not.toContain(proibido);
    }
  });

  it("opções da fila de impressão (API-12): 2ª via leva contador e a hora da 1ª impressão", async () => {
    const ctx = await setup();
    const id = await place(ctx);
    const original = new Date("2026-11-16T15:00:00.000Z");
    const t = (await buildPrintableOrder(id, { reprintCount: 2, printedAtOriginal: original }))!;
    expect(t).toMatchObject({ reprintCount: 2, printedAtOriginal: "2026-11-16T15:00:00.000Z", cancelNotice: false });
    expect(t.items.length).toBeGreaterThan(0);
  });

  it("aviso de cancelamento (API-12): só o necessário — sem itens, valores, contato nem endereço; contador zerado", async () => {
    const ctx = await setup();
    const id = await place(ctx, { type: "DELIVERY", address: "Rua A, 1", customerPhone: "11999999999", customerName: "Ana", notes: "sem cebola" });
    const original = new Date("2026-11-16T15:00:00.000Z");
    const t = (await buildPrintableOrder(id, { cancelNotice: true, reprintCount: 5, printedAtOriginal: original }))!;
    expect(printableOrderSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({
      cancelNotice: true,
      reprintCount: 0,
      printedAtOriginal: "2026-11-16T15:00:00.000Z",
      items: [],
      totalCents: 0,
      customerName: null,
      customerPhone: null,
      address: null,
      notes: null,
    });
    const dump = JSON.stringify(t);
    for (const proibido of ["Ana", "11999999999", "Rua A", "sem cebola"]) expect(dump, proibido).not.toContain(proibido);
  });

  it("pelo caminho HTTP do dispositivo: mesma carga, isolada por loja (token de B não lê pedido de A)", async () => {
    const a = await setup();
    const b = await setup();
    const id = await place(a, { paymentMethod: "DINHEIRO" });
    const token = async (ctx: Ctx) => json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: ctx.cookie }, payload: { label: "PC" } })).token.token as string;
    const tokenA = await token(a);
    const tokenB = await token(b);
    const ok = await app.inject({ method: "GET", url: `/api/device/orders/${id}/printable`, headers: { authorization: `Bearer ${tokenA}` } });
    expect(ok.statusCode).toBe(200);
    expect(printableOrderSchema.safeParse(json(ok).order).success).toBe(true);
    expect(json(ok).order).toMatchObject({ paymentStatus: "A_COBRAR", ticketSchemaVersion: TICKET_SCHEMA_VERSION });
    const alheio = await app.inject({ method: "GET", url: `/api/device/orders/${id}/printable`, headers: { authorization: `Bearer ${tokenB}` } });
    expect(alheio.statusCode).toBe(404);
  });
});
