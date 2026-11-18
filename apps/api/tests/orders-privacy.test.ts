// API-54a — privacidade das respostas de pedido do PAINEL (PRD-15; Nightingale: resposta SEMPRE por allowlist).
// A varredura procura no JSON inteiro o que nunca pode sair, e as regras de papel e idade do detalhe.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { contactAccessFor, maskPhone, RECENT_WINDOW_MS } from "../src/modules/orders/orders.view";
import { login, makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const PHONE = "11987654321";
const ADDRESS = "Rua das Acácias, 1234, apto 56";
const SEGREDOS = {
  providerPaymentId: "mp-SEGREDO-999",
  pixQrCode: "00020126-QR-COPIA-E-COLA-SEGREDO",
  pixQrCodeBase64: "UVJTRUdSRURP",
  idempotencyKey: "chave-idem-SEGREDO",
  refundContext: { userId: "usuario-SEGREDO", reason: { code: "ITEM_EM_FALTA", text: "nota-interna-do-contexto-SEGREDO" } },
  refundLastError: "erro-interno-SEGREDO",
  lastRawStatus: "raw-SEGREDO",
  reconcileNote: "nota-de-conciliacao-SEGREDO",
};

describe("maskPhone / contactAccessFor (puros)", () => {
  it("mascara tudo menos os últimos 4 dígitos", () => {
    expect(maskPhone("11987654321")).toBe("*******4321");
    expect(maskPhone("(11) 98765-4321")).toBe("*******4321");
    expect(maskPhone("123")).toBe("****");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("")).toBeNull();
  });

  it("OWNER sempre completo; STAFF completo em pedido aberto ou encerrado há < 24 h, mascarado depois", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(contactAccessFor("OWNER", { status: "CONCLUIDO" }, ago(30 * 86_400_000), now)).toBe("FULL");
    for (const status of ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA"]) {
      expect(contactAccessFor("STAFF", { status }, ago(30 * 86_400_000), now), status).toBe("FULL");
    }
    expect(contactAccessFor("STAFF", { status: "CONCLUIDO" }, ago(RECENT_WINDOW_MS - 1000), now)).toBe("FULL");
    expect(contactAccessFor("STAFF", { status: "CONCLUIDO" }, ago(RECENT_WINDOW_MS + 1000), now)).toBe("MASKED");
    expect(contactAccessFor("STAFF", { status: "CANCELADO" }, ago(2 * RECENT_WINDOW_MS), now)).toBe("MASKED");
    expect(contactAccessFor("STAFF", { status: "CONCLUIDO" }, null, now)).toBe("MASKED"); // sem data: o mais restritivo
  });
});

describe("API-54a — lista, ações e detalhe", () => {
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

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(
      await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } }),
    ).product.id as string;
    const invited = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: `staff-${Date.now()}@t.com`, password: "provisoria1" } });
    const staff = (await login(app, json(invited).user.email, "provisoria1")).cookie!;
    return { owner: cookie!, staff, storeId: storeId as string, slug: slug as string, productId };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  async function delivery(ctx: Ctx, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: "POST",
      url: `/stores/${ctx.slug}/orders`,
      payload: { type: "DELIVERY", customerName: "Ana", customerPhone: PHONE, address: ADDRESS, items: [{ productId: ctx.productId, quantity: 1 }], ...extra },
    });
    expect(res.statusCode, res.body).toBe(201);
    return json(res).orderId as string;
  }

  // Pedido PIX com TODOS os campos sensíveis do pagamento preenchidos, para a varredura ter o que achar.
  async function paidWithSecrets(ctx: Ctx) {
    const id = await delivery(ctx, { paymentMethod: "DINHEIRO" });
    await prisma.order.update({ where: { id }, data: { paymentMethod: "PIX", awaitingPayment: false } });
    await prisma.payment.create({
      data: { orderId: id, amountCents: 1000, status: "APROVADO", expiresAt: new Date(Date.now() + 60_000), ...SEGREDOS, refundContext: SEGREDOS.refundContext },
    });
    return id;
  }

  const PROIBIDOS = ["SEGREDO", "providerPaymentId", "pixQrCode", "pixQrCodeBase64", "idempotencyKey", "refundContext", "refundLastError", "lastRawStatus", "reconcileNote", PHONE, ADDRESS, "Rua das Acácias"];
  const varre = (corpo: unknown, permitidos: string[] = []) => {
    const dump = JSON.stringify(corpo);
    for (const proibido of PROIBIDOS.filter((p) => !permitidos.includes(p))) expect(dump, `vazou: ${proibido}`).not.toContain(proibido);
  };

  it("LISTA (OWNER e STAFF): nenhum telefone/endereço completo e nenhum campo sensível do pagamento — em nenhum pedido", async () => {
    const ctx = await setup();
    await paidWithSecrets(ctx);
    await delivery(ctx);
    for (const cookie of [ctx.owner, ctx.staff]) {
      const res = await app.inject({ method: "GET", url: "/api/orders", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const { orders } = json(res);
      expect(orders).toHaveLength(2);
      varre(orders);
      for (const o of orders) {
        expect(o.customerPhone).toBe("*******4321");
        expect(o.address).toBeNull();
        expect(o).toMatchObject({ hasPhone: true, hasAddress: true, contactMasked: true });
      }
      const paid = orders.find((o: { payment: unknown }) => o.payment);
      expect(Object.keys(paid.payment).sort()).toEqual(["amountCents", "expiresAt", "reconcileRequired", "refundPending", "status"]);
    }
  });

  it("allowlist: a resposta tem EXATAMENTE as chaves esperadas (um campo novo na tabela não chega ao navegador por acidente)", async () => {
    const ctx = await setup();
    await delivery(ctx);
    const [o] = json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: ctx.owner } })).orders;
    expect(Object.keys(o).sort()).toEqual(
      [
        "address", "allowedTransitions", "awaitingPayment", "blocked", "cancel", "canUndo", "canceledAt", "changeForCents", "code", "contactMasked", "createdAt",
        "customerName", "customerPhone", "delivererId", "deliverer", "deliveryFeeCents", "discountCents", "hasAddress", "hasPhone", "id", "items", "notes",
        "paymentMethod", "payment", "printedAt", "serverNow", "status", "source", "statusChangedAt", "subtotalCents", "tableId", "tipCents", "totalCents", "type", "undoUntil", "updatedAt",
      ].sort(),
    );
    expect(Object.keys(o.items[0]).sort()).toEqual(["id", "notes", "productName", "quantity", "unitPriceCents"]);
    // storeId, couponId e couponReleasedAt/refundLockedAt são internos e não saem.
    for (const interno of ["storeId", "couponId", "couponReleasedAt", "refundLockedAt"]) expect(o, interno).not.toHaveProperty(interno);
  });

  it("entregador na lista: só id e nome (sem telefone)", async () => {
    const ctx = await setup();
    const id = await delivery(ctx);
    const d = json(await app.inject({ method: "POST", url: "/api/deliverers", headers: { cookie: ctx.owner }, payload: { name: "Beto", phone: "11911112222" } })).deliverer;
    await app.inject({ method: "POST", url: `/api/orders/${id}/deliverer`, headers: { cookie: ctx.owner }, payload: { delivererId: d.id } });
    const [o] = json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: ctx.owner } })).orders;
    expect(o.deliverer).toEqual({ id: d.id, name: "Beto" });
    expect(JSON.stringify(o)).not.toContain("11911112222");
  });

  it("RESPOSTAS DE AÇÃO (aceitar, cancelar, desfazer, estorno) também por allowlist e sem contato completo", async () => {
    const ctx = await setup();
    const paid = await paidWithSecrets(ctx);
    const plain = await delivery(ctx);
    const respostas = [
      await app.inject({ method: "POST", url: `/api/orders/${plain}/transition`, headers: { cookie: ctx.staff }, payload: { to: "CONFIRMADO" } }),
      await app.inject({ method: "POST", url: `/api/orders/${plain}/undo`, headers: { cookie: ctx.staff } }),
      await app.inject({ method: "POST", url: `/api/orders/${plain}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA", text: "nota" } } }),
      await app.inject({ method: "POST", url: `/api/orders/${paid}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } }),
    ];
    for (const r of respostas) {
      expect([200, 202, 409], r.body).toContain(r.statusCode);
      varre(json(r));
    }
  });

  it("DETALHE do OWNER: contato completo, sem os campos sensíveis do pagamento; auditado; 404 igual para pedido de outra loja", async () => {
    const ctx = await setup();
    const other = await setup();
    const id = await paidWithSecrets(ctx);
    const res = await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: ctx.owner } });
    expect(res.statusCode).toBe(200);
    const { order } = json(res);
    expect(order).toMatchObject({ customerPhone: PHONE, address: ADDRESS, contactMasked: false });
    varre(order, [PHONE, ADDRESS, "Rua das Acácias"]);

    const alheio = await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: other.owner } });
    const inexistente = await app.inject({ method: "GET", url: `/api/orders/nao-existe-xyz`, headers: { cookie: other.owner } });
    expect([alheio.statusCode, json(alheio).code]).toEqual([404, "ORDER_NOT_FOUND"]);
    expect(alheio.body).toBe(inexistente.body); // não revela que o pedido existe em outra loja
    expect((await app.inject({ method: "GET", url: `/api/orders/${id}` })).statusCode).toBe(401);
  });

  it("STAFF: completo em pedido ABERTO e em encerrado há < 24 h; MASCARADO em encerrado há mais de 24 h", async () => {
    const ctx = await setup();
    const open = await delivery(ctx);
    const get = async (id: string) => json(await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: ctx.staff } })).order;
    expect(await get(open)).toMatchObject({ customerPhone: PHONE, address: ADDRESS, contactMasked: false });

    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"]) {
      expect((await app.inject({ method: "POST", url: `/api/orders/${open}/transition`, headers: { cookie: ctx.owner }, payload: { to } })).statusCode, to).toBe(200);
    }
    expect(await get(open)).toMatchObject({ customerPhone: PHONE, contactMasked: false }); // recém-concluído

    await prisma.orderStatusHistory.updateMany({ where: { orderId: open }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const velho = await get(open);
    expect(velho).toMatchObject({ customerPhone: "*******4321", address: null, contactMasked: true, hasPhone: true, hasAddress: true });
    expect(JSON.stringify(velho)).not.toContain(PHONE);
    // O OWNER continua vendo tudo no mesmo pedido antigo.
    const dono = json(await app.inject({ method: "GET", url: `/api/orders/${open}`, headers: { cookie: ctx.owner } })).order;
    expect(dono).toMatchObject({ customerPhone: PHONE, address: ADDRESS });
  });

  it("auditoria: cada abertura com contato completo grava order.view_contact SEM o dado; repetir em 10 min não duplica; contato mascarado não audita", async () => {
    const ctx = await setup();
    const id = await delivery(ctx);
    const open = () => app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: ctx.staff } });
    const count = (extra: object = {}) => prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "order.view_contact", targetId: id, ...extra } });

    await open();
    expect(await count()).toBe(1);
    await open();
    await open();
    expect(await count()).toBe(1); // dentro de 10 min: sem duplicar

    const row = await prisma.auditLog.findFirstOrThrow({ where: { storeId: ctx.storeId, action: "order.view_contact" } });
    const dump = JSON.stringify(row);
    for (const dado of [PHONE, ADDRESS, "Acácias", "Ana"]) expect(dump, dado).not.toContain(dado);

    // Outra pessoa (OWNER) abrindo o mesmo pedido gera a sua própria linha.
    await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: ctx.owner } });
    expect(await count()).toBe(2);

    // Passados os 10 min, nova abertura do mesmo usuário audita de novo.
    await prisma.auditLog.updateMany({ where: { action: "order.view_contact", userId: row.userId }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    await open();
    expect(await count()).toBe(3);

    // Mascarado (STAFF em pedido antigo) não é abertura de contato: não audita.
    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"]) {
      await app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie: ctx.owner }, payload: { to } });
    }
    await prisma.orderStatusHistory.updateMany({ where: { orderId: id }, data: { createdAt: new Date(Date.now() - 30 * 3600_000) } });
    await prisma.auditLog.deleteMany({ where: { action: "order.view_contact" } });
    await open();
    expect(await count()).toBe(0);
  });

  it("pedido sem telefone nem endereço (retirada) não gera auditoria de contato e não inventa campos", async () => {
    const ctx = await setup();
    const res = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }] } });
    const id = json(res).orderId as string;
    const { order } = json(await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: ctx.owner } }));
    expect(order).toMatchObject({ customerPhone: null, address: null, hasPhone: false, hasAddress: false });
    expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "order.view_contact" } })).toBe(0);
  });
});
