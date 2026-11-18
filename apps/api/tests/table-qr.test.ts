// API-22 — mesa e QR (ADR-0002 nível 1; RN-MB-01/06/09/12; CA-MB-06/07/10/14): cadastro, pedido pelo QR, "Minha mesa" só do aparelho, 404 único, isolamento.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-22 — mesa e QR", () => {
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
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const product = async (name: string, priceCents: number) => json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name, priceCents } })).product.id as string;
    const productId = await product("Pizza", 4000);
    const email = `s-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email, password: "provisoria-12" } });
    const staff = ((await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria-12" } })).headers["set-cookie"] as string).split(";")[0];
    return { owner: cookie!, staff, store, productId, product };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const mesa = async (l: Loja, label = "12") => json(await app.inject({ method: "POST", url: "/api/tables", headers: { cookie: l.owner }, payload: { label } })).table as { id: string; qrToken: string; qrPath: string; label: string };
  const pedir = (l: Loja, t: { qrToken: string }, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `/stores/${l.store.slug}/tables/${t.qrToken}/orders`, headers, payload: { items: [{ productId: l.productId, quantity: 1 }], ...body } });
  const minhas = (l: Loja, t: { qrToken: string }, headers: Record<string, string> = {}) => app.inject({ method: "GET", url: `/stores/${l.store.slug}/tables/${t.qrToken}/my-orders`, headers });

  it("M1 FELIZ: OWNER cadastra mesa; qrToken opaco (>=128 bits), nunca derivado de id/slug; rótulo repetido => 409", async () => {
    const l = await loja();
    const t = await mesa(l);
    expect(t.qrToken).toMatch(/^mcq_[A-Za-z0-9_-]{43}$/);
    expect(t.qrToken).not.toContain(l.store.slug);
    expect(t.qrPath).toBe(`/loja/${l.store.slug}/m/${t.qrToken}`);
    const dup = await app.inject({ method: "POST", url: "/api/tables", headers: { cookie: l.owner }, payload: { label: "12" } });
    expect([dup.statusCode, json(dup).code]).toEqual([409, "TABLE_LABEL_TAKEN"]);
    const lista = json(await app.inject({ method: "GET", url: "/api/tables", headers: { cookie: l.owner } }));
    expect(lista.tables.map((x: { label: string }) => x.label)).toEqual(["12"]);
  });

  it("PERMISSÃO: STAFF lista mas não cadastra, troca QR nem apaga; sem sessão 401", async () => {
    const l = await loja();
    const t = await mesa(l);
    expect((await app.inject({ method: "GET", url: "/api/tables", headers: { cookie: l.staff } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/tables", headers: { cookie: l.staff }, payload: { label: "9" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/tables/${t.id}/regenerate-qr`, headers: { cookie: l.staff } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/tables/${t.id}`, headers: { cookie: l.staff } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/tables" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/tables", payload: { label: "9" } })).statusCode).toBe(401);
  });

  it("ISOLAMENTO: loja B não vê, edita, troca nem apaga a mesa da loja A (404); QR de A com o slug de B => 404", async () => {
    const a = await loja();
    const b = await loja();
    const ta = await mesa(a);
    expect(json(await app.inject({ method: "GET", url: "/api/tables", headers: { cookie: b.owner } })).tables).toEqual([]);
    for (const [method, url, payload] of [["PATCH", `/api/tables/${ta.id}`, { active: false }], ["POST", `/api/tables/${ta.id}/regenerate-qr`, undefined], ["DELETE", `/api/tables/${ta.id}`, undefined]] as const) {
      expect((await app.inject({ method, url, headers: { cookie: b.owner }, payload })).statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await prisma.table.findUniqueOrThrow({ where: { id: ta.id } })).active).toBe(true);
    const cross = await app.inject({ method: "GET", url: `/stores/${b.store.slug}/tables/${ta.qrToken}/menu` });
    expect(cross.statusCode).toBe(404);
  });

  it("CA-MB-10: token inexistente, mesa inativa e slug divergente respondem o MESMO 404, com noindex e no-referrer (D2-3)", async () => {
    const a = await loja();
    const b = await loja();
    const t = await mesa(a);
    await app.inject({ method: "PATCH", url: `/api/tables/${t.id}`, headers: { cookie: a.owner }, payload: { active: false } });
    const t2 = await mesa(a, "13");
    const respostas = await Promise.all([
      app.inject({ method: "GET", url: `/stores/${a.store.slug}/tables/mcq_naoexiste/menu` }),
      app.inject({ method: "GET", url: `/stores/${a.store.slug}/tables/${t.qrToken}/menu` }),
      app.inject({ method: "GET", url: `/stores/${b.store.slug}/tables/${t2.qrToken}/menu` }),
    ]);
    expect(new Set(respostas.map((r) => `${r.statusCode}|${r.body}`)).size).toBe(1);
    expect(respostas[0].statusCode).toBe(404);
    expect(respostas[0].headers["referrer-policy"]).toBe("no-referrer");
    expect(respostas[0].headers["x-robots-tag"]).toContain("noindex");
    const ok = await app.inject({ method: "GET", url: `/stores/${a.store.slug}/tables/${t2.qrToken}/menu` });
    expect(ok.statusCode).toBe(200);
    expect(json(ok).table.label).toBe("13");
    expect(ok.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("CA-MB-14: trocar QR => o antigo devolve o 404 padrão e o novo funciona; auditado", async () => {
    const l = await loja();
    const t = await mesa(l);
    const novo = json(await app.inject({ method: "POST", url: `/api/tables/${t.id}/regenerate-qr`, headers: { cookie: l.owner } })).table;
    expect(novo.qrToken).not.toBe(t.qrToken);
    expect((await app.inject({ method: "GET", url: `/stores/${l.store.slug}/tables/${t.qrToken}/menu` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/stores/${l.store.slug}/tables/${novo.qrToken}/menu` })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(await prisma.auditLog.count({ where: { storeId: l.store.id, action: "table.regenerate_qr" } })).toBe(1);
  });

  it("RN-MB-01: pedido pelo QR nasce PENDENTE, tipo MESA, origem QR_MESA, preço do banco, sem tíquete até o aceite; devolve o token do aparelho UMA vez", async () => {
    const l = await loja();
    const t = await mesa(l);
    const r = await pedir(l, t, { customerName: "Ana", items: [{ productId: l.productId, quantity: 2 }] });
    expect(r.statusCode, r.body).toBe(201);
    const body = json(r);
    expect(body.deviceToken).toMatch(/^mcd_/);
    expect(body.status).toBe("PENDENTE");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect([o.type, o.source, o.status, o.tableId, o.totalCents, o.paymentMethod, o.paidAt]).toEqual(["MESA", "QR_MESA", "PENDENTE", t.id, 8000, null, null]);
    expect(o.deviceTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(o.deviceTokenHash).not.toContain(body.deviceToken);
    expect(await prisma.printJob.count({ where: { orderId: o.id } })).toBe(0);
    const r2 = await pedir(l, t, {}, { "x-device-token": body.deviceToken });
    expect(r2.statusCode).toBe(201);
    expect(json(r2).deviceToken).toBeUndefined();
  });

  it("preço vem do banco: produto de outra loja => 400; produto pausado => ITEM_UNAVAILABLE; nada gravado", async () => {
    const a = await loja();
    const b = await loja();
    const t = await mesa(a);
    const fora = await pedir(a, t, { items: [{ productId: b.productId, quantity: 1 }] });
    expect([fora.statusCode, json(fora).code]).toEqual([400, "PRODUCT_NOT_FOUND"]);
    await prisma.product.update({ where: { id: a.productId }, data: { active: false } });
    const pausado = await pedir(a, t);
    expect([pausado.statusCode, json(pausado).code]).toEqual([400, "ITEM_UNAVAILABLE"]);
    expect(await prisma.order.count()).toBe(0);
  });

  it("sem aceite (qrOrdersNeedApproval=false, com confirmação): nasce CONFIRMADO e com tíquete da cozinha; sem confirmar => 400; STAFF => 403", async () => {
    const l = await loja();
    const t = await mesa(l);
    const sem = await app.inject({ method: "POST", url: "/api/store/qr-settings", headers: { cookie: l.owner }, payload: { qrOrdersNeedApproval: false } });
    expect([sem.statusCode, json(sem).code]).toEqual([400, "CONFIRMATION_REQUIRED"]);
    expect((await app.inject({ method: "POST", url: "/api/store/qr-settings", headers: { cookie: l.staff }, payload: { qrOrdersNeedApproval: false, confirmNoApproval: true } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/store/qr-settings", headers: { cookie: l.owner }, payload: { qrOrdersNeedApproval: false, confirmNoApproval: true } })).statusCode).toBe(200);
    const r = await pedir(l, t);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(r).orderId } });
    expect(o.status).toBe("CONFIRMADO");
    expect(await prisma.printJob.count({ where: { orderId: o.id, kind: "ORDER_KITCHEN" } })).toBe(1);
  });

  it("loja pausada => 409 STORE_CLOSED; QR desligado => 409 QR_ORDERING_DISABLED; o cardápio continua aberto", async () => {
    const l = await loja();
    const t = await mesa(l);
    await prisma.store.update({ where: { id: l.store.id }, data: { acceptingOrders: false } });
    const fechada = await pedir(l, t);
    expect([fechada.statusCode, json(fechada).code]).toEqual([409, "STORE_CLOSED"]);
    await prisma.store.update({ where: { id: l.store.id }, data: { acceptingOrders: true } });
    await app.inject({ method: "POST", url: "/api/store/qr-settings", headers: { cookie: l.owner }, payload: { qrOrderingEnabled: false } });
    const off = await pedir(l, t);
    expect([off.statusCode, json(off).code]).toEqual([409, "QR_ORDERING_DISABLED"]);
    expect((await app.inject({ method: "GET", url: `/stores/${l.store.slug}/tables/${t.qrToken}/menu` })).statusCode).toBe(200);
  });

  it("CA-MB-06/07: 'Minha mesa' mostra só os pedidos do APARELHO; outro aparelho e quem só tem a foto do QR não veem consumo", async () => {
    const l = await loja();
    const t = await mesa(l);
    const a1 = json(await pedir(l, t));
    await pedir(l, t, {}, { "x-device-token": a1.deviceToken });
    const b1 = json(await pedir(l, t));
    const doA = json(await minhas(l, t, { "x-device-token": a1.deviceToken }));
    const doB = json(await minhas(l, t, { "x-device-token": b1.deviceToken }));
    expect(doA.orders).toHaveLength(2);
    expect(doB.orders).toHaveLength(1);
    expect(doB.orders[0].id).toBe(b1.orderId);
    const semToken = await minhas(l, t);
    expect([semToken.statusCode, json(semToken).orders]).toEqual([200, []]);
    expect(json(await minhas(l, t, { "x-device-token": "mcd_inventado" })).orders).toEqual([]);
    expect(JSON.stringify(doA)).not.toMatch(/deviceTokenHash|customerPhone/);
    const t2 = await mesa(l, "13");
    expect(json(await minhas(l, t2, { "x-device-token": a1.deviceToken })).orders).toEqual([]);
  });

  it("RN-MB-09: chamar atendente e pedir a conta só avisam (sem pedido), no máximo 1 por minuto por tipo; mesa inexistente => 404", async () => {
    const l = await loja();
    const t = await mesa(l);
    const url = (p: string, tok = t.qrToken) => `/stores/${l.store.slug}/tables/${tok}/${p}`;
    expect(json(await app.inject({ method: "POST", url: url("call-waiter") }))).toEqual({ notified: true });
    expect(json(await app.inject({ method: "POST", url: url("call-waiter") }))).toEqual({ notified: false, throttled: true });
    expect(json(await app.inject({ method: "POST", url: url("ask-bill") }))).toEqual({ notified: true });
    expect((await app.inject({ method: "POST", url: url("ask-bill", "mcq_x") })).statusCode).toBe(404);
    expect(await prisma.order.count()).toBe(0);
  });

  it("D2-2: rajada do mesmo IP é limitada (429) sem bloquear a mesa para outro IP", async () => {
    const l = await loja();
    const t = await mesa(l);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await pedir(l, t)).statusCode);
    expect(codes.slice(0, 6).every((c) => c === 201)).toBe(true);
    expect(codes.slice(6)).toEqual([429, 429]);
    const outroIp = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/tables/${t.qrToken}/orders`, remoteAddress: "203.0.113.9", payload: { items: [{ productId: l.productId, quantity: 1 }] } });
    expect(outroIp.statusCode).toBe(201);
  });

  it("mesa com pedido não se apaga (409); sem pedido, apaga; o pedido aparece no painel com origem e mesa, sem o hash do aparelho", async () => {
    const l = await loja();
    const t = await mesa(l);
    const vazia = await mesa(l, "99");
    const { orderId } = json(await pedir(l, t));
    const del = await app.inject({ method: "DELETE", url: `/api/tables/${t.id}`, headers: { cookie: l.owner } });
    expect([del.statusCode, json(del).code]).toEqual([409, "TABLE_HAS_ORDERS"]);
    expect((await app.inject({ method: "DELETE", url: `/api/tables/${vazia.id}`, headers: { cookie: l.owner } })).statusCode).toBe(204);
    const lista = json(await app.inject({ method: "GET", url: "/api/tables", headers: { cookie: l.owner } }));
    expect(lista.tables.find((x: { id: string }) => x.id === t.id).pendingOrders).toBe(1);
    const detalhe = json(await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: { cookie: l.staff } }));
    const o = detalhe.order ?? detalhe;
    expect([o.source, o.tableId, o.type]).toEqual(["QR_MESA", t.id, "MESA"]);
    expect(JSON.stringify(detalhe)).not.toContain("deviceTokenHash");
  });
});
