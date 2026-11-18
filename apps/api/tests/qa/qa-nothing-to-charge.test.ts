// QA-27 (Deming) — API-66: `nothingToCharge` no tíquete. Sondas independentes das do Turing.
// Ideia: a decisão de NÃO COBRAR tem de falhar para o lado seguro (cobrar). Por isso: (1) todo status de pagamento do ENUM é
// classificado de forma explícita (um status novo derruba o teste e obriga uma decisão); (2) a leitura real do banco com cada status;
// (3) o tíquete é montado NO CLAIM (sem cópia antiga): pagamento aprovado depois de o job nascer ⇒ false; (4) fila: aviso e teste ⇒ false.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, PaymentStatus } from "@meucardapio/db";
import { buildPrintableOrder, nothingToCharge } from "../../src/lib/printable";
import { makeApp, registerStore, resetDb } from "../helpers";

vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const VIVOS = ["PENDENTE", "APROVADO", "EM_ANALISE", "REEMBOLSADO", "ESTORNO_PENDENTE", "CONTESTADO"] as const; // dinheiro em jogo ⇒ cobra
const MORTOS = ["REJEITADO", "EXPIRADO", "CANCELADO"] as const; // nunca houve cobrança possível ⇒ libera

describe("QA-27 nothingToCharge (API-66)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
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
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 4000 } })).product.id as string;
    const token = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "PC" } })).token.token as string;
    const cp = await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: cookie! }, payload: { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 20 } });
    expect(cp.statusCode, cp.body).toBe(201);
    return { owner: cookie!, storeId: store.id, slug: store.slug, productId, token };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;
  const pedidoGratis = async (c: Ctx) => {
    const r = await app.inject({ method: "POST", url: `/stores/${c.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: c.productId, quantity: 1 }], couponCode: "TUDO" } });
    expect(r.statusCode, r.body).toBe(201);
    return json(r).orderId as string;
  };
  const setMode = (c: Ctx, mode: string) => app.inject({ method: "PUT", url: "/api/store/print-mode", headers: { cookie: c.owner }, payload: { mode } });
  const claim = async (c: Ctx) => json(await app.inject({ method: "POST", url: "/api/device/print-jobs/claim", headers: bearer(c.token), payload: {} })).job;
  const ack = (c: Ctx, jobId: string) => app.inject({ method: "POST", url: `/api/device/print-jobs/${jobId}/ack`, headers: bearer(c.token), payload: { status: "PRINTED" } });
  // o tíquete dentro do job entregue (o nome do campo pode variar; aceita os formatos conhecidos)
  const ticketDe = (job: Record<string, unknown>) => (job.order ?? job.ticket ?? job) as Record<string, unknown>;

  it("Q1 todo status do ENUM PaymentStatus está classificado (vivo ou morto): um status NOVO derruba este teste e obriga uma decisão", () => {
    const todos = Object.values(PaymentStatus).sort();
    expect([...VIVOS, ...MORTOS].sort(), "o enum mudou: decida se o status novo é dinheiro em jogo (vivo) ou morto").toEqual(todos);
    for (const s of VIVOS) expect(nothingToCharge({ totalCents: 0 }, { status: s }), s).toBe(false);
    for (const s of MORTOS) expect(nothingToCharge({ totalCents: 0 }, { status: s }), s).toBe(true);
  });

  it("Q2 leitura REAL do banco: pedido de total 0 com cada status de pagamento ⇒ vivos false, mortos true, sem pagamento true; total > 0 nunca true", async () => {
    const c = await setup();
    const id = await pedidoGratis(c);
    expect((await buildPrintableOrder(id)).nothingToCharge, "sem pagamento").toBe(true);
    const pay = await prisma.payment.create({ data: { orderId: id, providerPaymentId: "qa-1", amountCents: 0, status: "PENDENTE" } });
    for (const s of [...VIVOS, ...MORTOS]) {
      await prisma.payment.update({ where: { id: pay.id }, data: { status: s } });
      const t = await buildPrintableOrder(id);
      expect(t.nothingToCharge, `total 0 + ${s}`).toBe((MORTOS as readonly string[]).includes(s));
    }
    // total > 0 (o pedido é alterado no banco só para a sonda): nenhum status libera
    await prisma.order.update({ where: { id }, data: { totalCents: 4000 } });
    for (const s of [...VIVOS, ...MORTOS]) {
      await prisma.payment.update({ where: { id: pay.id }, data: { status: s } });
      expect((await buildPrintableOrder(id)).nothingToCharge, `total 4000 + ${s}`).toBe(false);
    }
    await prisma.payment.delete({ where: { id: pay.id } });
    expect((await buildPrintableOrder(id)).nothingToCharge, "total 4000 sem pagamento").toBe(false);
  });

  it("Q3 o tíquete é montado NO CLAIM: um pagamento APROVADO que aparece depois de o job nascer vira nothingToCharge=false (nada de cópia velha)", async () => {
    const c = await setup();
    expect((await setMode(c, "QUEUE")).statusCode).toBe(200);
    const id = await pedidoGratis(c);
    expect(await prisma.printJob.count({ where: { orderId: id, kind: "ORDER_KITCHEN", status: "PENDING" } })).toBe(1);
    await prisma.payment.create({ data: { orderId: id, providerPaymentId: "qa-2", amountCents: 0, status: "APROVADO" } }); // aprovado ENTRE a criação do job e o claim
    const job = await claim(c);
    expect(job?.kind).toBe("ORDER_KITCHEN");
    expect(ticketDe(job)).toMatchObject({ nothingToCharge: false });
  });

  it("Q4 fila: ORDER_KITCHEN de pedido grátis ⇒ true (versão 3); depois de cancelar, o AVISO ⇒ false; e o tíquete de teste ⇒ false", async () => {
    const c = await setup();
    expect((await setMode(c, "QUEUE")).statusCode).toBe(200);
    const id = await pedidoGratis(c);
    const kitchen = await claim(c);
    expect(kitchen.kind).toBe("ORDER_KITCHEN");
    expect(ticketDe(kitchen)).toMatchObject({ ticketSchemaVersion: 3, totalCents: 0, nothingToCharge: true });
    expect((await ack(c, kitchen.id)).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: c.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } })).statusCode).toBe(200);
    const aviso = await claim(c);
    expect(aviso.kind).toBe("ORDER_CANCEL_NOTICE");
    expect(ticketDe(aviso)).toMatchObject({ cancelNotice: true, nothingToCharge: false });
    expect((await ack(c, aviso.id)).statusCode).toBe(200);
    const criado = await app.inject({ method: "POST", url: "/api/print-jobs/test", headers: { cookie: c.owner }, payload: {} });
    expect(criado.statusCode, criado.body).toBeLessThan(300);
    const teste = await claim(c);
    expect(teste?.kind).toBe("TEST");
    expect(ticketDe(teste)).toMatchObject({ nothingToCharge: false });
  });
});
