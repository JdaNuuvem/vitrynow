// API-19 — aceitar em 1 toque (OWNER e STAFF) + link público de acompanhamento do pedido (token opaco, sem dado pessoal).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, orderTokenHeader, registerStore, resetDb } from "./helpers";

describe("API-19 — aceitar e acompanhar o pedido", () => {
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

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "Pizza", priceCents: 3000 } })).product.id as string;
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email, password: "provisoria-12" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "provisoria-12" } });
    const staff = (login.headers["set-cookie"] as string).split(";")[0];
    return { owner: cookie!, staff, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  async function pedido(l: Loja) {
    const res = await app.inject({
      method: "POST",
      url: `/stores/${l.store.slug}/orders`,
      payload: { type: "DELIVERY", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "DINHEIRO", customerName: "Maria Segredo", customerPhone: "11987654321", address: "Rua Reservada 123", notes: "sem cebola secreta" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const orderId = json(res).orderId as string;
    return { orderId, headers: orderTokenHeader(orderId) };
  }
  const track = (slug: string, orderId: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url: `/stores/${slug}/orders/${orderId}/tracking`, headers });
  const transition = (cookie: string, orderId: string, to: string) => app.inject({ method: "POST", url: `/api/orders/${orderId}/transition`, headers: { cookie }, payload: { to } });

  it("FELIZ: com o token o cliente vê código, tipo, etapa e horários; aceitar (1 chamada) e avançar aparecem no acompanhamento", async () => {
    const l = await loja();
    const p = await pedido(l);
    const r0 = await track(l.store.slug, p.orderId, p.headers);
    expect(r0.statusCode, r0.body).toBe(200);
    expect(json(r0)).toMatchObject({ store: { name: expect.any(String) }, order: { status: "PENDENTE", type: "DELIVERY", code: expect.any(String) }, cancelReason: null });
    expect((await transition(l.owner, p.orderId, "CONFIRMADO")).statusCode).toBe(200); // aceitar em UM toque
    const r1 = json(await track(l.store.slug, p.orderId, p.headers));
    expect(r1.order.status).toBe("CONFIRMADO");
    expect(r1.timeline.map((t: { status: string }) => t.status)).toContain("CONFIRMADO");
    await transition(l.owner, p.orderId, "EM_PREPARO");
    expect(json(await track(l.store.slug, p.orderId, p.headers)).order.status).toBe("EM_PREPARO");
  });

  it("PERMISSÃO: o STAFF também aceita em 1 toque; quem não tem sessão não aceita (401)", async () => {
    const l = await loja();
    const p = await pedido(l);
    expect((await app.inject({ method: "POST", url: `/api/orders/${p.orderId}/transition`, payload: { to: "CONFIRMADO" } })).statusCode).toBe(401);
    expect((await transition(l.staff, p.orderId, "CONFIRMADO")).statusCode).toBe(200);
    expect(json(await track(l.store.slug, p.orderId, p.headers)).order.status).toBe("CONFIRMADO");
  });

  it("ISOLAMENTO: o dono de OUTRA loja não aceita este pedido (404) e o acompanhamento não abre pela slug da outra loja", async () => {
    const a = await loja();
    const b = await loja();
    const p = await pedido(a);
    const r = await transition(b.owner, p.orderId, "CONFIRMADO");
    expect(r.statusCode).toBe(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).status).toBe("PENDENTE");
    expect((await track(b.store.slug, p.orderId, p.headers)).statusCode).toBe(404);
  });

  it("ERRO: sem token, token errado, token de OUTRO pedido, pedido inexistente e loja inexistente respondem o MESMO 404", async () => {
    const l = await loja();
    const p1 = await pedido(l);
    const p2 = await pedido(l);
    const respostas = [
      await track(l.store.slug, p1.orderId),
      await track(l.store.slug, p1.orderId, { "x-order-token": "mco_errado" }),
      await track(l.store.slug, p1.orderId, p2.headers),
      await track(l.store.slug, "cnaoexiste000000000000000", p1.headers),
      await track("loja-que-nao-existe", p1.orderId, p1.headers),
    ];
    for (const r of respostas) expect([r.statusCode, r.body]).toEqual([404, JSON.stringify({ error: "Pedido não encontrado." })]);
  });

  it("PRIVACIDADE: a resposta nunca leva telefone, endereço, nome, observações, ids internos nem dados de pagamento", async () => {
    const l = await loja();
    const p = await pedido(l);
    const body = (await track(l.store.slug, p.orderId, p.headers)).body;
    for (const proibido of ["Maria Segredo", "11987654321", "Rua Reservada", "cebola", "customerPhone", "address", "providerPaymentId", "publicTokenHash", "storeId", p.orderId, l.store.id]) {
      expect(body, proibido).not.toContain(proibido);
    }
    const chaves = Object.keys(json({ body }).order).sort();
    expect(chaves).toEqual(["awaitingPayment", "code", "createdAt", "status", "type"]);
  });

  it("CABEÇALHOS: não indexável, sem Referer e sem cache (também no 404)", async () => {
    const l = await loja();
    const p = await pedido(l);
    for (const r of [await track(l.store.slug, p.orderId, p.headers), await track(l.store.slug, p.orderId)]) {
      expect(r.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(r.headers["referrer-policy"]).toBe("no-referrer");
      expect(r.headers["cache-control"]).toBe("no-store");
    }
  });

  it("DESFAZER: a linha do tempo mostra só avanços e cancelamento, nunca as entradas internas de desfazer/sistema", async () => {
    const l = await loja();
    const p = await pedido(l);
    await transition(l.owner, p.orderId, "CONFIRMADO");
    const undo = await app.inject({ method: "POST", url: `/api/orders/${p.orderId}/undo`, headers: { cookie: l.owner } });
    expect(undo.statusCode, undo.body).toBe(200);
    const visiveis = await prisma.orderStatusHistory.count({ where: { orderId: p.orderId, kind: { in: ["ADVANCE", "CANCEL"] } } });
    const internas = await prisma.orderStatusHistory.count({ where: { orderId: p.orderId, kind: { notIn: ["ADVANCE", "CANCEL"] } } });
    expect(internas).toBeGreaterThan(0);
    const r = json(await track(l.store.slug, p.orderId, p.headers));
    expect(r.timeline).toHaveLength(visiveis);
    expect(r.order.status).toBe("PENDENTE");
  });

  it("CANCELADO: o cliente vê a frase fixa do motivo (nunca o texto livre da loja) e a etapa final", async () => {
    const l = await loja();
    const p = await pedido(l);
    const c = await app.inject({ method: "POST", url: `/api/orders/${p.orderId}/cancel`, headers: { cookie: l.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect(c.statusCode, c.body).toBe(200);
    const r = json(await track(l.store.slug, p.orderId, p.headers));
    expect(r.order.status).toBe("CANCELADO");
    expect(typeof r.cancelReason.customerMessage).toBe("string");
    expect(r.timeline.at(-1).status).toBe("CANCELADO");
  });

  it("LIMITE de taxa: mais de 120 consultas por minuto do mesmo IP recebem 429 (token errado não dá palpite grátis)", async () => {
    const l = await loja();
    const p = await pedido(l);
    let limitado = 0;
    for (let i = 0; i < 125; i += 1) {
      const r = await track(l.store.slug, p.orderId, { "x-order-token": `mco_palpite_${i}` });
      if (r.statusCode === 429) limitado += 1;
    }
    expect(limitado).toBeGreaterThan(0);
  });
});
