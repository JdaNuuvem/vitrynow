// QA-21 — API-12/C1: o AVISO DE CANCELAMENTO não pode se perder em silêncio.
// Regra do contrato (ADR-0004 / API-12): pedido cujo tíquete já saiu (PRINTED ou CLAIMED) e que é cancelado gera 1 job
// ORDER_CANCEL_NOTICE para a cozinha. A falha é injetada NO BANCO (gatilho que recusa o INSERT do aviso), então o teste
// vale para qualquer implementação (aviso dentro ou fora da transação do cancelamento). Invariante: nunca "pedido
// CANCELADO + tíquete já impresso + nenhum aviso". Antes do C1 (aviso pós-commit com .catch engolindo o erro) isto
// falhava (cancelar=200 pedido=CANCELADO avisos=0); com o C1 o cancelamento é recusado e o pedido fica intacto.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

describe("QA aviso de cancelamento da fila de impressão (C1)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qa_recusa_aviso ON "PrintJob"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS qa_recusa_aviso_fn()`);
    await app.close();
    await resetDb();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const json = (r: { body: string }) => JSON.parse(r.body);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const recusarAviso = async () => {
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION qa_recusa_aviso_fn() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'QA: INSERT do aviso recusado de propósito'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_recusa_aviso BEFORE INSERT ON "PrintJob" FOR EACH ROW WHEN (NEW.kind = 'ORDER_CANCEL_NOTICE') EXECUTE FUNCTION qa_recusa_aviso_fn()`);
  };
  const liberarAviso = async () => { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qa_recusa_aviso ON "PrintJob"`); };

  async function pedidoImpresso() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    // API-12b: o aviso de cancelamento só existe com a loja em modo QUEUE (em LEGACY ninguém consome a fila).
    await prisma.store.update({ where: { id: store.id }, data: { printMode: "QUEUE" } });
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
    const token = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "PC" } })).token.token as string;
    const created = await app.inject({ method: "POST", url: `/stores/${store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 1 }] } });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = json(created).orderId as string;
    const claimed = json(await app.inject({ method: "POST", url: "/api/device/print-jobs/claim", headers: bearer(token), payload: {} })).job;
    expect(claimed?.kind).toBe("ORDER_KITCHEN");
    const ack = await app.inject({ method: "POST", url: `/api/device/print-jobs/${claimed.id}/ack`, headers: bearer(token), payload: { status: "PRINTED" } });
    expect(ack.statusCode, ack.body).toBe(200);
    return { owner: cookie!, orderId, token };
  }
  const cancelar = (owner: string, orderId: string) =>
    app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`, headers: { cookie: owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
  const avisos = (orderId: string) => prisma.printJob.findMany({ where: { orderId, kind: "ORDER_CANCEL_NOTICE" } });

  it("A1 (controle) sem falha: cancelar pedido já impresso cria exatamente 1 aviso", async () => {
    const c = await pedidoImpresso();
    expect((await cancelar(c.owner, c.orderId)).statusCode).toBe(200);
    expect(await avisos(c.orderId)).toHaveLength(1);
  });

  it("A2 se o INSERT do aviso falha, o pedido já impresso NUNCA fica CANCELADO sem aviso", async () => {
    const c = await pedidoImpresso();
    await recusarAviso();
    const res = await cancelar(c.owner, c.orderId);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: c.orderId } });
    const n = (await avisos(c.orderId)).length;
    const resumo = `cancelar=${res.statusCode} pedido=${order.status} avisos=${n}`;
    expect(order.status === "CANCELADO" && n === 0, resumo).toBe(false);
  });

  it("A3 depois da falha, repetir o cancelamento (com o banco normal) conclui: CANCELADO e exatamente 1 aviso", async () => {
    const c = await pedidoImpresso();
    await recusarAviso();
    await cancelar(c.owner, c.orderId);
    await liberarAviso();
    const res = await cancelar(c.owner, c.orderId);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: c.orderId } });
    expect(res.statusCode, res.body).toBe(200);
    expect(order.status).toBe("CANCELADO");
    expect(await avisos(c.orderId)).toHaveLength(1);
  });
});
