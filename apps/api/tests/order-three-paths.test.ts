// D5+D12 — o MESMO pedido pelos três caminhos (vitrine, mesa, manual): mesmo total, itens, tíquete e eventos.
// Diferenças POR DESIGN, fixadas aqui: status/source de nascimento e forma de pagamento (mesa paga no recebimento).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { resetLimits } from "../src/lib/slidingLimit";
import { publishToStore } from "../src/realtime/hub";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/realtime/hub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/realtime/hub")>()),
  publishToStore: vi.fn(),
}));

describe("pedido pelos três caminhos", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    resetLimits();
    app = makeApp();
    await app.ready();
    vi.mocked(publishToStore).mockClear();
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
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const owner = { cookie: cookie! };
    const categoryId = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: owner, payload: { name: "C" } })).category.id;
    const product = async (name: string, priceCents: number) =>
      json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: owner, payload: { categoryId, name, priceCents } })).product.id as string;
    const items = [
      { productId: await product("Pizza", 4000), quantity: 2 },
      { productId: await product("Suco", 799), quantity: 3 },
    ];
    return { owner, store, items };
  }

  async function observar(storeId: string, send: () => Promise<{ statusCode: number; body: string }>) {
    vi.mocked(publishToStore).mockClear();
    const before = (await prisma.order.findMany({ where: { storeId }, select: { id: true } })).map((o) => o.id);
    const r = await send();
    expect(r.statusCode, r.body).toBe(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId, id: { notIn: before } },
      include: { items: { orderBy: { productName: "asc" } }, statusHistory: true },
    });
    const jobs = await prisma.printJob.findMany({ where: { orderId: order.id }, select: { kind: true } });
    return {
      money: { subtotalCents: order.subtotalCents, totalCents: order.totalCents },
      items: order.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
      ticket: jobs.map((j) => j.kind),
      events: vi.mocked(publishToStore).mock.calls.filter(([id]) => id === storeId).map(([, e]) => e.type),
      birth: { status: order.status, source: order.source, history: order.statusHistory.map((h) => h.status) },
    };
  }

  it("mesmos itens, sem cupom/frete/gorjeta: total, itens, tíquete e eventos iguais", async () => {
    const l = await loja();
    const table = json(await app.inject({ method: "POST", url: "/api/tables", headers: l.owner, payload: { label: "1" } })).table as { qrToken: string };

    const vitrine = await observar(l.store.id, () =>
      app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: l.items } }));
    const mesa = await observar(l.store.id, () =>
      app.inject({ method: "POST", url: `/stores/${l.store.slug}/tables/${table.qrToken}/orders`, payload: { items: l.items } }));
    const manual = await observar(l.store.id, () =>
      app.inject({ method: "POST", url: "/api/orders", headers: l.owner, payload: { type: "BALCAO", paymentMethod: "DEBITO", items: l.items } }));

    for (const other of [mesa, manual]) {
      expect(other.money).toEqual(vitrine.money);
      expect(other.items).toEqual(vitrine.items);
      expect(other.ticket).toEqual(vitrine.ticket);
      expect(other.events).toEqual(vitrine.events);
    }
    expect(vitrine.money).toEqual({ subtotalCents: 10397, totalCents: 10397 });
    expect(vitrine.ticket).toEqual(["ORDER_KITCHEN"]);
    expect(vitrine.events).toEqual(["order.created", "print.available"]);
    expect([vitrine.birth.status, mesa.birth.status, manual.birth.status]).toEqual(["PENDENTE", "PENDENTE", "CONFIRMADO"]);
    expect(mesa.birth.source).toBe("QR_MESA");
    expect(manual.birth.source).toBe("PAINEL");
  });

  // Mesa não aceita cupom: aqui só vitrine x manual.
  it("com cupom percentual que arredonda: vitrine e manual dão o mesmo desconto e total", async () => {
    const l = await loja();
    const c = await app.inject({ method: "POST", url: "/api/coupons", headers: l.owner, payload: { code: "PROMO", discountType: "PERCENT", discountValue: 15 } });
    expect(c.statusCode, c.body).toBeLessThan(300);
    const vitrine = await observar(l.store.id, () =>
      app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", couponCode: "PROMO", items: l.items } }));
    const manual = await observar(l.store.id, () =>
      app.inject({ method: "POST", url: "/api/orders", headers: l.owner, payload: { type: "BALCAO", paymentMethod: "DEBITO", couponCode: "PROMO", items: l.items } }));
    expect(manual.money).toEqual(vitrine.money);
    expect(vitrine.money).toEqual({ subtotalCents: 10397, totalCents: 10397 - 1560 });
    expect(manual.ticket).toEqual(vitrine.ticket);
    expect(manual.events).toEqual(vitrine.events);
  });
});