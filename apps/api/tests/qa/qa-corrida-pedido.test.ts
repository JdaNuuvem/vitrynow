// QA-15 — corridas do pedido com BARREIRA determinística (lacuna declarada pelo Turing no API-02).
//
// Como a barreira funciona: uma transação do teste segura `SELECT … FOR UPDATE` na linha do pedido.
// Dispara-se as duas ações concorrentes; ambas LEEM o pedido (leitura não bloqueia) e depois travam no
// `UPDATE … WHERE status = :esperado`. Só então soltamos a barreira (COMMIT): as duas escritas disputam
// de verdade a mesma linha. Sem a condição `WHERE status`, as duas teriam sucesso e o pedido ficaria
// inconsistente. O resultado esperado é SEMPRE: exatamente um vencedor, um 409, histórico coerente.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

// Mercado Pago sempre simulado: nenhuma chamada de rede real.
vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../../src/lib/mercadopago";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("QA corridas do pedido (barreira FOR UPDATE)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = JSON.parse(response.body).store as { id: string; slug: string };
    const cat = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).body).category.id;
    const productId = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).body).product.id as string;
    return { cookie: cookie!, store, productId };
  }
  async function novoPedido(l: Awaited<ReturnType<typeof loja>>, extra: object = {}) {
    const res = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: l.productId, quantity: 1 }], ...extra } });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).orderId as string;
  }

  // Segura a linha do pedido, dispara as ações, espera todas travarem e solta a barreira.
  async function comBarreira<T>(orderId: string, dispararAcoes: () => Promise<T>[]): Promise<T[]> {
    let soltar!: () => void;
    const solta = new Promise<void>((r) => (soltar = r));
    let travou!: () => void;
    const travada = new Promise<void>((r) => (travou = r));
    const tx = prisma.$transaction(
      async (t) => {
        await t.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        travou();
        await solta;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    await travada;
    const acoes = dispararAcoes(); // começam a executar; as escritas ficam presas na barreira
    await sleep(800); // tempo para as duas lerem e chegarem ao UPDATE bloqueado
    soltar();
    await tx;
    return Promise.all(acoes);
  }

  const historico = (orderId: string) =>
    prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: "asc" }, select: { status: true, kind: true } });

  it("C1 cliente cancela × loja aceita: exatamente um vence, o outro recebe 409, histórico coerente", async () => {
    const l = await loja();
    const orderId = await novoPedido(l);
    const [cliente, painel] = await comBarreira(orderId, () => [
      app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders/${orderId}/cancel` }),
      app.inject({ method: "POST", url: `/api/orders/${orderId}/transition`, headers: { cookie: l.cookie }, payload: { to: "CONFIRMADO" } }),
    ]);
    const codigos = [cliente.statusCode, painel.statusCode].sort();
    expect(codigos, `cliente=${cliente.statusCode} painel=${painel.statusCode}`).toEqual([200, 409]);
    const final = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(final.status).toBe(cliente.statusCode === 200 ? "CANCELADO" : "CONFIRMADO");
    const h = await historico(orderId);
    expect(h.filter((x) => x.status !== "PENDENTE").length, JSON.stringify(h)).toBe(1); // só UMA mudança além da criação
  });

  it("C2 duas ações de avanço idênticas (CONFIRMADO×CONFIRMADO): uma só passa, uma linha no histórico", async () => {
    const l = await loja();
    const orderId = await novoPedido(l);
    const go = () => app.inject({ method: "POST", url: `/api/orders/${orderId}/transition`, headers: { cookie: l.cookie }, payload: { to: "CONFIRMADO" } });
    const [a, b] = await comBarreira(orderId, () => [go(), go()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect((await historico(orderId)).filter((x) => x.status === "CONFIRMADO").length).toBe(1);
  });

  it("C3 cliente e loja cancelam ao mesmo tempo: o cancelamento vale UMA vez e o cupom é devolvido UMA vez (nunca usedCount negativo)", async () => {
    const l = await loja();
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: l.cookie }, payload: { code: "dez", discountType: "FIXED", discountValue: 100, maxUses: 5 } });
    const orderId = await novoPedido(l, { couponCode: "dez" });
    expect((await prisma.coupon.findFirstOrThrow({ where: { storeId: l.store.id } })).usedCount).toBe(1);
    const [cliente, painel] = await comBarreira(orderId, () => [
      app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders/${orderId}/cancel` }),
      app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`, headers: { cookie: l.cookie }, payload: { reason: { code: "ITEM_EM_FALTA" } } }),
    ]);
    // Cancelar é idempotente: o perdedor pode receber 200 (já cancelado) ou 409. O que NÃO pode é efeito duplo.
    expect([200, 409], `cliente=${cliente.statusCode} painel=${painel.statusCode}`).toContain(cliente.statusCode);
    expect([200, 409]).toContain(painel.statusCode);
    expect(cliente.statusCode === 200 || painel.statusCode === 200).toBe(true);
    expect((await prisma.coupon.findFirstOrThrow({ where: { storeId: l.store.id } })).usedCount).toBe(0);
    expect((await historico(orderId)).filter((x) => x.status === "CANCELADO").length).toBe(1);
  });

  it("C4 desfazer × avançar de novo: nunca deixa o pedido em estado que a história não explica", async () => {
    const l = await loja();
    const orderId = await novoPedido(l);
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/transition`, headers: { cookie: l.cookie }, payload: { to: "CONFIRMADO" } });
    const [desfazer, avancar] = await comBarreira(orderId, () => [
      app.inject({ method: "POST", url: `/api/orders/${orderId}/undo`, headers: { cookie: l.cookie } }),
      app.inject({ method: "POST", url: `/api/orders/${orderId}/transition`, headers: { cookie: l.cookie }, payload: { to: "EM_PREPARO" } }),
    ]);
    expect([desfazer.statusCode, avancar.statusCode].sort(), `undo=${desfazer.statusCode} avancar=${avancar.statusCode}`).toEqual([200, 409]);
    const final = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(final.status).toBe(desfazer.statusCode === 200 ? "PENDENTE" : "EM_PREPARO");
  });
  it("C5 (API-02) estornar (cancelar pedido PIX pago) × concluir o pedido: nunca termina com dinheiro devolvido E pedido concluído", async () => {
    const l = await loja();
    vi.mocked(mp.createPixPayment).mockResolvedValue({ providerPaymentId: "mp-c5", status: "pending", pixQrCode: "x", pixQrCodeBase64: "y", expiresAt: new Date(Date.now() + 600_000) });
    vi.mocked(mp.refundPayment).mockResolvedValue(undefined as never);
    const orderId = await novoPedido(l, { paymentMethod: "PIX" });
    // PIX aprovado (como se o webhook já tivesse chegado) e pedido levado até PRONTO pelo painel.
    await prisma.payment.update({ where: { orderId }, data: { status: "APROVADO" } });
    await prisma.order.update({ where: { id: orderId }, data: { awaitingPayment: false } });
    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO"]) {
      const r = await app.inject({ method: "POST", url: `/api/orders/${orderId}/transition`, headers: { cookie: l.cookie }, payload: { to } });
      expect(r.statusCode, `avançar para ${to}`).toBe(200);
    }
    const [cancelar, concluir] = await comBarreira(orderId, () => [
      app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`, headers: { cookie: l.cookie }, payload: { reason: { code: "ITEM_EM_FALTA" } } }),
      app.inject({ method: "POST", url: `/api/orders/${orderId}/transition`, headers: { cookie: l.cookie }, payload: { to: "CONCLUIDO" } }),
    ]);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    const resumo = `cancelar=${cancelar.statusCode} concluir=${concluir.statusCode} pedido=${order.status} pagamento=${order.payment?.status}`;
    // Combinações proibidas: dinheiro devolvido com pedido entregue, ou pedido cancelado com dinheiro retido.
    expect(order.status === "CONCLUIDO" && order.payment?.status === "REEMBOLSADO", resumo).toBe(false);
    expect(order.status === "CANCELADO" && order.payment?.status === "APROVADO", resumo).toBe(false);
  });
});
