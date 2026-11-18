// API-59 — cancelar pedido de caixa JÁ FECHADO (RN-B3-07, RN-CX-14): só OWNER, com confirmação, DEVOLUCAO no caixa atual, idempotente.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-59 — cancelar pedido de caixa fechado", () => {
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
  const H = 3600_000;

  async function loja(opts: { caixaAberto?: boolean } = {}) {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 4000 } })).product.id as string;
    const user = await prisma.user.findFirstOrThrow({ where: { storeId: store.id } });
    const agora = Date.now();
    // caixa de ontem, já FECHADO, com o pedido recebido dentro dele
    const fechado = await prisma.cashSession.create({
      data: { storeId: store.id, openedByUserId: user.id, openingBalanceCents: 1000, openedAt: new Date(agora - 30 * H), closedAt: new Date(agora - 20 * H), closingBalanceCents: 5000, expectedClosingCents: 5000, differenceCents: 0 },
    });
    const atual = opts.caixaAberto === false ? null : await prisma.cashSession.create({ data: { storeId: store.id, openedByUserId: user.id, openingBalanceCents: 0, openedAt: new Date(agora - H) } });
    return { owner: cookie!, store, productId, fechado, atual };
  }
  async function pedido(c: Awaited<ReturnType<typeof loja>>, paidHoursAgo = 25, status: "CONFIRMADO" | "EM_PREPARO" = "CONFIRMADO") {
    const res = await app.inject({ method: "POST", url: `/stores/${c.store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: c.productId, quantity: 1 }], paymentMethod: "DINHEIRO" } });
    const orderId = json(res).orderId as string;
    await prisma.order.update({ where: { id: orderId }, data: { status, paidAt: new Date(Date.now() - paidHoursAgo * H) } });
    return orderId;
  }
  async function staffCookie(owner: string) {
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0]!;
  }
  const cancelar = (cookie: string, orderId: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`, headers: { cookie }, payload: { reason: { code: "ITEM_EM_FALTA" }, ...extra } });
  const devolucoes = (storeId: string) => prisma.cashMovement.findMany({ where: { type: "DEVOLUCAO", cashSession: { storeId } } });

  it("STAFF => 403 CASH_CLOSED_OWNER_ONLY e nada muda", async () => {
    const c = await loja();
    const id = await pedido(c);
    const r = await cancelar(await staffCookie(c.owner), id, { acknowledgeClosedCash: true });
    expect(r.statusCode).toBe(403);
    expect(json(r).code).toBe("CASH_CLOSED_OWNER_ONLY");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CONFIRMADO");
    expect(await devolucoes(c.store.id)).toHaveLength(0);
  });

  it("OWNER sem confirmação => 409 CASH_CLOSED_ACK_REQUIRED e nada muda", async () => {
    const c = await loja();
    const id = await pedido(c);
    const r = await cancelar(c.owner, id);
    expect(r.statusCode).toBe(409);
    expect(json(r).code).toBe("CASH_CLOSED_ACK_REQUIRED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CONFIRMADO");
  });

  it("feliz: cancela, cria 1 DEVOLUCAO no caixa ATUAL (não no fechado), vincula o pedido, audita sem texto livre", async () => {
    const c = await loja();
    const id = await pedido(c);
    const r = await cancelar(c.owner, id, { acknowledgeClosedCash: true });
    expect(r.statusCode, r.body).toBe(200);
    expect(json(r).order.status).toBe("CANCELADO");
    const d = await devolucoes(c.store.id);
    expect(d).toHaveLength(1);
    expect(d[0]!.cashSessionId).toBe(c.atual!.id);
    expect(d[0]!.amountCents).toBe(4000);
    expect(d[0]!.createdByRole).toBe("OWNER");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).cashRefundMovementId).toBe(d[0]!.id);
    expect(await prisma.cashMovement.count({ where: { cashSessionId: c.fechado.id } })).toBe(0); // o caixa fechado NÃO muda
    const a = await prisma.auditLog.findMany({ where: { storeId: c.store.id, action: "order.cancel_closed_cash" } });
    expect(a).toHaveLength(1);
    expect(a[0]!.metadata).toEqual({ reason: "ITEM_EM_FALTA", amountCents: 4000 });
  });

  it("a DEVOLUCAO reduz o esperado do caixa atual", async () => {
    const c = await loja();
    const id = await pedido(c);
    await cancelar(c.owner, id, { acknowledgeClosedCash: true });
    const cur = json(await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: c.owner } }));
    expect(JSON.stringify(cur)).toContain("4000");
    expect(cur.summary.expectedCents).toBe(-4000);
  });

  it("sem caixa aberto => 409 CASH_REQUIRED e nada muda", async () => {
    const c = await loja({ caixaAberto: false });
    const id = await pedido(c);
    const r = await cancelar(c.owner, id, { acknowledgeClosedCash: true });
    expect(r.statusCode).toBe(409);
    expect(json(r).code).toBe("CASH_REQUIRED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CONFIRMADO");
    expect(await devolucoes(c.store.id)).toHaveLength(0);
  });

  it("idempotente: repetir não cria 2ª DEVOLUCAO; simultâneas criam uma só", async () => {
    const c = await loja();
    const id = await pedido(c);
    const rs = await Promise.all([1, 2, 3].map(() => cancelar(c.owner, id, { acknowledgeClosedCash: true })));
    expect(rs.some((r) => r.statusCode === 200)).toBe(true);
    for (const r of rs) expect([200, 409]).toContain(r.statusCode);
    await cancelar(c.owner, id, { acknowledgeClosedCash: true });
    expect(await devolucoes(c.store.id)).toHaveLength(1);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: id, kind: "CANCEL" } })).toBe(1);
  });

  it("pedido do turno ATUAL (dinheiro recebido no caixa aberto): cancela normal, sem DEVOLUCAO e sem confirmação", async () => {
    const c = await loja();
    const id = await pedido(c, 0.5);
    const r = await cancelar(c.owner, id);
    expect(r.statusCode, r.body).toBe(200);
    expect(await devolucoes(c.store.id)).toHaveLength(0);
  });

  it("pedido sem dinheiro recebido (paidAt nulo): cancela normal", async () => {
    const c = await loja();
    const id = await pedido(c);
    await prisma.order.update({ where: { id }, data: { paidAt: null } });
    expect((await cancelar(c.owner, id)).statusCode).toBe(200);
    expect(await devolucoes(c.store.id)).toHaveLength(0);
  });

  it("isolamento: dono da loja B não cancela pedido da loja A (404) e nada muda", async () => {
    const a = await loja();
    const idA = await pedido(a);
    const b = await loja();
    expect((await cancelar(b.owner, idA, { acknowledgeClosedCash: true })).statusCode).toBe(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: idA } })).status).toBe("CONFIRMADO");
    expect(await devolucoes(b.store.id)).toHaveLength(0);
  });
});
