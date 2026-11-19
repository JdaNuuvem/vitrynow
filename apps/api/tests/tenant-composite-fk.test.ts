// API-48 (ADR-0009 §1.1): o BANCO recusa referência entre lojas nas relações que viraram FK composta (id, storeId), mesmo que o código esqueça o filtro.
// A loja A nunca referencia categoria, cupom, entregador ou conta (receipt) da loja B, nem por SQL direto nem pela API; excluir cupom/entregador mantém os pedidos.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("FKs compostas por loja (API-48)", { timeout: 90_000 }, () => {
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

  async function loja(n: string) {
    const r = await registerStore(app, { slug: `fk-${n}`, code: `FK${n.toUpperCase()}` });
    const storeId = json(r.response).store.id as string;
    const cookie = r.cookie!;
    const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as never });
    const category = json(await post("/api/catalog/categories", { name: `Cat ${n}` })).category.id as string;
    const product = json(await post("/api/catalog/products", { categoryId: category, name: `Prod ${n}`, priceCents: 1000 })).product.id as string;
    const coupon = json(await post("/api/coupons", { code: `CUPOM${n.toUpperCase()}`, discountType: "PERCENT", discountValue: 10 })).coupon.id as string;
    const deliverer = json(await post("/api/deliverers", { name: `Moto ${n}` })).deliverer.id as string;
    const user = await prisma.user.findFirstOrThrow({ where: { storeId } });
    const receipt = await prisma.receipt.create({ data: { storeId, subtotalCents: 1000, totalCents: 1000, receivedByUserId: user.id } });
    const order = await prisma.order.create({ data: { storeId, code: `K${n}1`, type: "BALCAO", status: "CONCLUIDO", subtotalCents: 1000, totalCents: 1000, paymentMethod: "DINHEIRO" } });
    return { storeId, cookie, post, category, product, coupon, deliverer, receipt, order };
  }

  const violation = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "P2003" });

  it("A não aponta para categoria, cupom, entregador nem recibo de B (SQL/Prisma direto): violação de integridade, nada gravado", async () => {
    const a = await loja("a");
    const b = await loja("b");
    await violation(prisma.product.update({ where: { id: a.product }, data: { categoryId: b.category } }));
    await violation(prisma.order.update({ where: { id: a.order.id }, data: { couponId: b.coupon } }));
    await violation(prisma.order.update({ where: { id: a.order.id }, data: { delivererId: b.deliverer } }));
    await violation(prisma.order.update({ where: { id: a.order.id }, data: { receiptId: b.receipt.id } }));
    await violation(prisma.receiptPayment.create({ data: { receiptId: b.receipt.id, storeId: a.storeId, method: "PIX", amountCents: 100 } }));
    // a referência válida (da própria loja) continua aceita
    await prisma.order.update({ where: { id: a.order.id }, data: { couponId: a.coupon, delivererId: a.deliverer, receiptId: a.receipt.id } });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: a.product } })).toMatchObject({ categoryId: a.category });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: b.order.id } })).toMatchObject({ couponId: null, delivererId: null, receiptId: null });
  });

  it("pela API: A não cria produto na categoria de B e não muda o produto para ela (404/400, nada muda)", async () => {
    const a = await loja("a");
    const b = await loja("b");
    const criar = await a.post("/api/catalog/products", { categoryId: b.category, name: "Invasor", priceCents: 500 });
    expect([400, 404]).toContain(criar.statusCode);
    const mover = await a.post(`/api/catalog/products/${a.product}`, { categoryId: b.category });
    expect([400, 404]).toContain(mover.statusCode);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.product } })).categoryId).toBe(a.category);
    expect(await prisma.product.count({ where: { storeId: a.storeId } })).toBe(1);
  });

  it("excluir cupom ou entregador zera o vínculo dos pedidos e mantém o pedido (como antes da FK composta)", async () => {
    const a = await loja("a");
    await prisma.order.update({ where: { id: a.order.id }, data: { couponId: a.coupon, delivererId: a.deliverer } });
    const delCupom = await a.post(`/api/coupons/${a.coupon}/delete`, {});
    expect(delCupom.statusCode, delCupom.body).toBeLessThan(300);
    const delEntregador = await a.post(`/api/deliverers/${a.deliverer}/delete`, {});
    expect(delEntregador.statusCode, delEntregador.body).toBeLessThan(300);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: a.order.id } })).toMatchObject({ couponId: null, delivererId: null, totalCents: 1000 });
  });

  it("apagar a loja inteira continua funcionando (cascata com as FKs compostas): sem sobra de categoria, produto, cupom, entregador, recibo ou pedido", async () => {
    const a = await loja("a");
    await prisma.order.update({ where: { id: a.order.id }, data: { couponId: a.coupon, delivererId: a.deliverer, receiptId: a.receipt.id } });
    await prisma.receiptPayment.create({ data: { receiptId: a.receipt.id, storeId: a.storeId, method: "PIX", amountCents: 100 } });
    await prisma.store.delete({ where: { id: a.storeId } });
    for (const count of [prisma.category.count(), prisma.product.count(), prisma.coupon.count(), prisma.deliverer.count(), prisma.receipt.count(), prisma.receiptPayment.count(), prisma.order.count()]) expect(await count).toBe(0);
  });
});
