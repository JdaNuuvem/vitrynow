// API-66 — o SERVIDOR diz, no tíquete, se não há nada a cobrar (`nothingToCharge`, fonte única; ticketSchemaVersion 3).
// Contrato de teste: cupom 100% sem taxa ⇒ true; cupom parcial ⇒ false; taxa > 0 ⇒ false; sem pagamento e total > 0 ⇒ false;
// o campo nunca sai ausente em pedido real; aviso de cancelamento e teste de impressora ⇒ false.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { TICKET_SCHEMA_VERSION } from "@meucardapio/shared-types";
import { buildPrintableOrder, buildTestTicket, nothingToCharge } from "../src/lib/printable";
import { makeApp, registerStore, resetDb, useMockedProvider } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";

describe("API-66 — nothingToCharge no tíquete", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    useMockedProvider(mp);
    vi.clearAllMocks();
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
    await prisma.store.update({ where: { id: storeId }, data: { deliveryFeeCents: 600 } });
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 4000 } })).product.id as string;
    const token = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "PC" } })).token.token as string;
    return { owner: cookie!, storeId: storeId as string, slug: slug as string, productId, token };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const coupon = (ctx: Ctx, payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.owner }, payload });
  const order = async (ctx: Ctx, payload: Record<string, unknown> = {}) => {
    const r = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], ...payload } });
    expect(r.statusCode, r.body).toBe(201);
    return json(r).orderId as string;
  };
  // O tíquete como o cliente o recebe (rota legada do dispositivo; a loja nasce em LEGACY)
  const ticketOf = async (ctx: Ctx, id: string) => {
    const r = await app.inject({ method: "GET", url: `/api/device/orders/${id}/printable`, headers: { authorization: `Bearer ${ctx.token}` } });
    expect(r.statusCode, r.body).toBe(200);
    return json(r).order as Record<string, unknown>;
  };

  it("cupom 100% em retirada (total 0, sem taxa nem gorjeta) ⇒ nothingToCharge true, com desconto > 0 e sem forma de pagamento", async () => {
    const ctx = await setup();
    await coupon(ctx, { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 5 });
    const t = await ticketOf(ctx, await order(ctx, { couponCode: "TUDO", paymentMethod: "PIX" }));
    expect(t).toMatchObject({ ticketSchemaVersion: TICKET_SCHEMA_VERSION, totalCents: 0, subtotalCents: 4000, discountCents: 4000, paymentMethod: null, nothingToCharge: true });
    expect(TICKET_SCHEMA_VERSION).toBe(3);
    expect(vi.mocked(mp.createPixPayment)).not.toHaveBeenCalled();
  });

  it("cupom FIXO que cobre o subtotal ⇒ true; cupom parcial (10%) ⇒ false, com total > 0", async () => {
    const ctx = await setup();
    await coupon(ctx, { code: "CINQ", discountType: "FIXED", discountValue: 5000, maxUses: 5 });
    await coupon(ctx, { code: "DEZ", discountType: "PERCENT", discountValue: 10 });
    expect(await ticketOf(ctx, await order(ctx, { couponCode: "CINQ" }))).toMatchObject({ totalCents: 0, nothingToCharge: true });
    expect(await ticketOf(ctx, await order(ctx, { couponCode: "DEZ", paymentMethod: "DINHEIRO" }))).toMatchObject({ totalCents: 3600, discountCents: 400, nothingToCharge: false });
  });

  it("entrega com taxa de R$ 6,00 e cupom 100% ⇒ total 600 ⇒ false; gorjeta com cupom 100% ⇒ false", async () => {
    const ctx = await setup();
    await coupon(ctx, { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 5 });
    const entrega = await order(ctx, { type: "DELIVERY", customerName: "Ana", customerPhone: "11987654321", address: "Rua A, 1", couponCode: "TUDO", paymentMethod: "DINHEIRO" });
    expect(await ticketOf(ctx, entrega)).toMatchObject({ totalCents: 600, nothingToCharge: false });
    const gorjeta = await order(ctx, { couponCode: "TUDO", tipCents: 300, paymentMethod: "DINHEIRO" });
    expect(await ticketOf(ctx, gorjeta)).toMatchObject({ totalCents: 300, nothingToCharge: false });
  });

  it("sem pagamento e total > 0 ⇒ false; PIX pendente com total > 0 ⇒ false", async () => {
    const ctx = await setup();
    expect(await ticketOf(ctx, await order(ctx))).toMatchObject({ totalCents: 4000, nothingToCharge: false });
    vi.mocked(mp.createPixPayment).mockResolvedValue({ providerPaymentId: "p-1", pixQrCode: "qr", pixQrCodeBase64: "b64", expiresAt: new Date(Date.now() + 600_000) } as never);
    const pix = await order(ctx, { paymentMethod: "PIX" });
    await prisma.order.update({ where: { id: pix }, data: { awaitingPayment: false } }); // o tíquete só é lido depois de confirmado; aqui só importa o campo
    expect(await ticketOf(ctx, pix)).toMatchObject({ totalCents: 4000, nothingToCharge: false });
  });

  it("o campo NUNCA sai ausente em pedido real: boolean em toda amostra", async () => {
    const ctx = await setup();
    await coupon(ctx, { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 5 });
    for (const extra of [{}, { couponCode: "TUDO" }, { paymentMethod: "DINHEIRO" }]) {
      const t = await ticketOf(ctx, await order(ctx, extra));
      expect(typeof t.nothingToCharge, JSON.stringify(extra)).toBe("boolean");
    }
  });

  it("2ª via de pedido de total zero mantém true; aviso de cancelamento e tíquete de teste ⇒ SEMPRE false (total 0 só porque não levam valores)", async () => {
    const ctx = await setup();
    await coupon(ctx, { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 5 });
    const id = await order(ctx, { couponCode: "TUDO" });
    expect(await buildPrintableOrder(id, { reprintCount: 1, printedAtOriginal: new Date() })).toMatchObject({ reprintCount: 1, nothingToCharge: true });
    const aviso = await buildPrintableOrder(id, { cancelNotice: true, printedAtOriginal: new Date() });
    expect(aviso).toMatchObject({ cancelNotice: true, totalCents: 0, nothingToCharge: false });
    expect(buildTestTicket("j1", new Date())).toMatchObject({ totalCents: 0, nothingToCharge: false });
  });

  it("a regra pura: total 0 só libera sem pagamento ou com pagamento MORTO; qualquer dinheiro em jogo (ou total > 0) ⇒ false", () => {
    for (const status of ["REJEITADO", "EXPIRADO", "CANCELADO"] as const) expect(nothingToCharge({ totalCents: 0 }, { status }), status).toBe(true);
    expect(nothingToCharge({ totalCents: 0 }, null)).toBe(true);
    expect(nothingToCharge({ totalCents: 0 }, undefined)).toBe(true);
    for (const status of ["PENDENTE", "APROVADO", "EM_ANALISE", "REEMBOLSADO", "ESTORNO_PENDENTE", "CONTESTADO"] as const) {
      expect(nothingToCharge({ totalCents: 0 }, { status }), status).toBe(false);
    }
    for (const total of [1, 600, 4000]) expect(nothingToCharge({ totalCents: total }, null), String(total)).toBe(false);
    expect(nothingToCharge({ totalCents: -1 }, null)).toBe(false); // valor impossível nunca vira "nada a cobrar"
  });
});
