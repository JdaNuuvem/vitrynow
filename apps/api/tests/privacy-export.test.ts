// API-52b (LGPD art. 18): exportação dos dados de UM titular. OWNER, reautenticação, auditoria sem conteúdo, isolamento entre lojas, chave desligada.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { login, makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/email", () => ({ sendPasswordResetEmail: vi.fn(), sendMfaCodeEmail: vi.fn() }));
vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const PHONE = "11987654321";
const SENHA = "senha12345";

describe("privacidade: exportar dados do titular", { timeout: 60_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let seq = 0;
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.PRIVACY_ACTIONS_ENABLED = "true";
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    delete process.env.MFA_ENFORCED;
    delete process.env.PRIVACY_ACTIONS_ENABLED;
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  async function setup() {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const invited = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: `staff-ex-${Date.now()}-${seq++}@t.com`, password: "provisoria1" } });
    const staff = (await login(app, json(invited).user.email, "provisoria1")).cookie!;
    return { owner: cookie!, staff, storeId };
  }
  async function mk(storeId: string, phone = PHONE) {
    seq += 1;
    const order = await prisma.order.create({
      data: {
        storeId, code: `X${String(seq).padStart(4, "0")}`, type: "DELIVERY", status: "CONCLUIDO", customerName: "Maria Silva", customerPhone: phone,
        address: "Rua A, 1", notes: "sem cebola", internalNote: "VIP", totalCents: 2500, subtotalCents: 2500, paymentMethod: "DINHEIRO",
        items: { create: [{ productName: "Pizza", quantity: 1, unitPriceCents: 2500, notes: "bem passada" }] },
      },
    });
    await prisma.orderStatusHistory.create({ data: { orderId: order.id, status: "CONCLUIDO", reasonText: "cliente Maria ligou" } });
    return order.code;
  }
  const exp = (cookie: string, body: object, auth = true) =>
    app.inject({ method: "POST", url: "/api/privacy/export", headers: { cookie }, payload: { ...(auth ? { currentPassword: SENHA } : {}), ...body } });

  it("caminho feliz: devolve os dados do titular, sem cache, e audita SEM o conteúdo", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    await mk(ctx.storeId);
    await mk(ctx.storeId, "21999990000"); // outro titular: fora
    const r = await exp(ctx.owner, { phone: "(11) 98765-4321" });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const body = json(r);
    expect(body).toMatchObject({ format: "privacy-export-v1", storeId: ctx.storeId });
    expect(body.orders).toHaveLength(2);
    expect(body.orders[0]).toMatchObject({ customerName: "Maria Silva", customerPhone: PHONE, address: "Rua A, 1", totalCents: 2500, items: [{ productName: "Pizza", notes: "bem passada" }], statusHistory: [{ reasonText: "cliente Maria ligou" }] });
    const audit = await prisma.auditLog.findMany({ where: { storeId: ctx.storeId, action: "privacy.export_customer" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({ orders: 2, by: "PHONE" });
    expect(JSON.stringify(audit[0])).not.toMatch(/Maria|98765|Rua A/);
  });

  it("por código do pedido; sem pedidos achados devolve lista vazia", async () => {
    const ctx = await setup();
    const code = await mk(ctx.storeId);
    expect(json(await exp(ctx.owner, { orderCode: code })).orders).toHaveLength(1);
    const vazio = await exp(ctx.owner, { phone: "11911112222" });
    expect(vazio.statusCode).toBe(200);
    expect(json(vazio).orders).toEqual([]);
  });

  it("erro: sem alvo ou com os dois ⇒ 400; sem senha ⇒ 403 REAUTH_REQUIRED; senha errada ⇒ 403 e nada exportado nem auditado", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    expect((await exp(ctx.owner, {})).statusCode).toBe(400);
    expect((await exp(ctx.owner, { phone: PHONE, orderCode: "X1" })).statusCode).toBe(400);
    const sem = await exp(ctx.owner, { phone: PHONE }, false);
    expect(sem.statusCode).toBe(403);
    expect(json(sem).code).toBe("REAUTH_REQUIRED");
    const errada = await exp(ctx.owner, { phone: PHONE, currentPassword: "errada-12345" });
    expect(errada.statusCode).toBe(403);
    expect(json(errada).code).toBe("PASSWORD_INVALID");
    expect(errada.body).not.toMatch(/Maria/);
    expect(await prisma.auditLog.count({ where: { action: "privacy.export_customer" } })).toBe(0);
  });

  it("com MFA ativa, sem código ⇒ 403 MFA_REQUIRED (propósito export_customer)", async () => {
    process.env.MFA_ENFORCED = "true";
    const ctx = await setup();
    await mk(ctx.storeId);
    const r = await exp(ctx.owner, { phone: PHONE }, false);
    expect(r.statusCode).toBe(403);
    expect(json(r)).toMatchObject({ code: "MFA_REQUIRED", purpose: "export_customer" });
  });

  it("permissão: STAFF ⇒ 403; sem login ⇒ 401", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    expect((await exp(ctx.staff, { phone: PHONE })).statusCode).toBe(403);
    const anon = await app.inject({ method: "POST", url: "/api/privacy/export", payload: { phone: PHONE, currentPassword: SENHA } });
    expect(anon.statusCode).toBe(401);
  });

  it("isolamento: a loja B não exporta pedidos da loja A, nem pelo código", async () => {
    const a = await setup();
    const code = await mk(a.storeId);
    const b = await setup();
    expect(json(await exp(b.owner, { phone: PHONE })).orders).toEqual([]);
    expect(json(await exp(b.owner, { orderCode: code })).orders).toEqual([]);
  });

  it("pedido já anonimizado não entra na exportação", async () => {
    const ctx = await setup();
    const code = await mk(ctx.storeId);
    await prisma.order.update({ where: { storeId_code: { storeId: ctx.storeId, code } }, data: { anonymizedAt: new Date(), customerName: null, customerPhone: null } });
    expect(json(await exp(ctx.owner, { orderCode: code })).orders).toEqual([]);
  });

  it("chave desligada (padrão) ⇒ 404 FEATURE_DISABLED, também na anonimização", async () => {
    delete process.env.PRIVACY_ACTIONS_ENABLED;
    const ctx = await setup();
    const r = await exp(ctx.owner, { phone: PHONE });
    expect(r.statusCode).toBe(404);
    expect(json(r).code).toBe("FEATURE_DISABLED");
    const a = await app.inject({ method: "POST", url: "/api/privacy/anonymize", headers: { cookie: ctx.owner }, payload: { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1, currentPassword: SENHA } });
    expect(a.statusCode).toBe(404);
  });
});
