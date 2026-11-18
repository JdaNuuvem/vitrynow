// API-23 — impressão da rodada (ADR-0002 §2.7, ADR-0004): o tíquete da mesa sai com MESA, RODADA e QUEM PEDIU; cada pedido da mesa é uma rodada, imprime ao chegar (com ou sem aceite).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { printableOrderSchema } from "@meucardapio/shared-types";
import { resetLimits } from "../src/lib/slidingLimit";
import { buildPrintableOrder } from "../src/lib/printable";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-23 — impressão da rodada da mesa", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    resetLimits();
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

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    await prisma.store.update({ where: { id: store.id }, data: { printMode: "QUEUE" } });
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "Pizza", priceCents: 4000 } })).product.id as string;
    const token = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "PC" } })).token.token as string;
    const mesa = json(await app.inject({ method: "POST", url: "/api/tables", headers: { cookie: cookie! }, payload: { label: "12" } })).table as { id: string; qrToken: string };
    return { owner: cookie!, store, productId, token, mesa };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const pedir = (l: Loja, headers: Record<string, string> = {}, body: Record<string, unknown> = {}, mesa = l.mesa) =>
    app.inject({ method: "POST", url: `/stores/${l.store.slug}/tables/${mesa.qrToken}/orders`, headers, payload: { items: [{ productId: l.productId, quantity: 1 }], ...body } });
  const claim = async (l: Loja) => json(await app.inject({ method: "POST", url: "/api/device/print-jobs/claim", headers: { authorization: `Bearer ${l.token}` }, payload: {} })).job;

  it("FELIZ: pedido da mesa imprime AO CHEGAR, mesmo com aceite ligado; o tíquete traz Mesa 12, rodada 1 e Aparelho 1; schema válido, versão 4", async () => {
    const l = await loja();
    const r = json(await pedir(l));
    expect(r.status).toBe("PENDENTE"); // o aceite só muda o estado
    const job = await claim(l);
    expect(job).toMatchObject({ kind: "ORDER_KITCHEN" });
    expect(printableOrderSchema.safeParse(job.ticket).success).toBe(true);
    expect(job.ticket).toMatchObject({ orderId: r.orderId, type: "MESA", tableLabel: "Mesa 12", round: 1, requestedBy: "Aparelho 1", ticketSchemaVersion: 4, address: null, customerPhone: null });
    expect(JSON.stringify(job.ticket)).not.toMatch(/mcd_|deviceTokenHash/);
  });

  it("RODADAS: cada pedido da mesa é uma rodada (1, 2, 3); o mesmo aparelho segue como Aparelho 1, outro aparelho é Aparelho 2; o nome informado vence", async () => {
    const l = await loja();
    const a = json(await pedir(l));
    const a2 = json(await pedir(l, { "x-device-token": a.deviceToken }));
    const b = json(await pedir(l));
    const c = json(await pedir(l, {}, { customerName: "Ana" }));
    const ticket = async (id: string) => (await buildPrintableOrder(id))!;
    expect(await ticket(a.orderId)).toMatchObject({ round: 1, requestedBy: "Aparelho 1" });
    expect(await ticket(a2.orderId)).toMatchObject({ round: 2, requestedBy: "Aparelho 1" });
    expect(await ticket(b.orderId)).toMatchObject({ round: 3, requestedBy: "Aparelho 2" });
    expect(await ticket(c.orderId)).toMatchObject({ round: 4, requestedBy: "Ana" });
    // 1 job por pedido/rodada (dedupe): nada de papel em dobro
    expect(await prisma.printJob.count({ where: { storeId: l.store.id, kind: "ORDER_KITCHEN" } })).toBe(4);
  });

  it("rodada recomeça depois do recebimento e ignora pedido cancelado", async () => {
    const l = await loja();
    const a = json(await pedir(l));
    const b = json(await pedir(l));
    await prisma.order.update({ where: { id: a.orderId }, data: { status: "CANCELADO" } });
    expect(await buildPrintableOrder(b.orderId)).toMatchObject({ round: 1 });
    await prisma.order.update({ where: { id: b.orderId }, data: { paidAt: new Date() } }); // mesa recebida (API-24)
    const c = json(await pedir(l));
    expect(await buildPrintableOrder(c.orderId)).toMatchObject({ round: 1 });
  });

  it("ISOLAMENTO: a rodada de uma mesa não conta pedidos de outra mesa nem de outra loja", async () => {
    const a = await loja();
    const b = await loja();
    const outra = json(await app.inject({ method: "POST", url: "/api/tables", headers: { cookie: a.owner }, payload: { label: "13" } })).table as { id: string; qrToken: string };
    await pedir(a);
    await pedir(b);
    const na13 = json(await pedir(a, {}, {}, outra));
    expect(await buildPrintableOrder(na13.orderId)).toMatchObject({ tableLabel: "Mesa 13", round: 1, requestedBy: "Aparelho 1" });
  });

  it("pedido que não é de mesa continua sem mesa/rodada/quem pediu no tíquete; o aviso de cancelamento de mesa leva só a mesa", async () => {
    const l = await loja();
    const balcao = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: l.productId, quantity: 1 }] } });
    const t = (await buildPrintableOrder(json(balcao).orderId))!;
    expect(t.round).toBeUndefined();
    expect(t.requestedBy).toBeUndefined();
    expect(t.tableLabel ?? null).toBeNull();
    const m = json(await pedir(l));
    const aviso = (await buildPrintableOrder(m.orderId, { cancelNotice: true }))!;
    expect(aviso).toMatchObject({ cancelNotice: true, tableLabel: "Mesa 12", items: [], totalCents: 0 });
    expect(aviso.round).toBeUndefined();
  });
});
