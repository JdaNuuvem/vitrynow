// QA — API-54a: resposta de pedido SEMPRE por allowlist (achado do Tesla + Nightingale, PRD-15).
// A lista do painel não pode devolver telefone/endereço completos nem campos internos do pagamento, para NENHUM papel
// (OWNER e STAFF). O WebSocket só carrega { type, orderId }. Convenção: bug(...) = it.fails (verde enquanto o defeito
// existe); QA_STRICT=1 roda como teste normal; quem corrigir (API-54a) troca bug(...) por it(...).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";
import { subscribe } from "../../src/realtime/hub";
import { activateSubscription } from "../../src/lib/subscription";

vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../../src/lib/mercadopago";


const PHONE = "11987654321";
const ADDRESS = "Rua Sigilosa Número 777, apto 12, Bairro Privado";
const PROVIDER_ID = "mp-segredo-123456";

// campos que NUNCA podem aparecer em resposta de pedido para o painel (nome da chave)
const INTERNAL_KEYS = ["providerPaymentId", "idempotencyKey", "refundContext", "pixQrCode", "pixQrCodeBase64", "refundLastError", "lastRawStatus", "tokenHash", "passwordHash"];

function varrer(json: string) {
  const achados: string[] = [];
  if (json.includes(PHONE)) achados.push("telefone completo");
  if (json.includes(ADDRESS)) achados.push("endereço completo");
  if (json.includes(PROVIDER_ID)) achados.push("id do provedor de pagamento (valor)");
  for (const k of INTERNAL_KEYS) if (json.includes(`"${k}"`)) achados.push(`campo interno ${k}`);
  return achados;
}

describe("QA privacidade das respostas de pedido (API-54a)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function cenario() {
    const { cookie, response } = await registerStore(app);
    const store = JSON.parse(response.body).store as { id: string; slug: string };
    const cat = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).body).category.id;
    const productId = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 2500 } })).body).product.id as string;
    // pedido de ENTREGA com PIX aprovado: tem telefone, endereço e um Payment com id do provedor
    vi.mocked(mp.createPixPayment).mockResolvedValue({ providerPaymentId: PROVIDER_ID, status: "pending", pixQrCode: "000201SEGREDO", pixQrCodeBase64: "QUJDU0VHUkVETw==", expiresAt: new Date(Date.now() + 600_000) });
    const res = await app.inject({
      method: "POST", url: `/stores/${store.slug}/orders`,
      payload: { type: "DELIVERY", customerName: "Cliente Sigiloso", customerPhone: PHONE, address: ADDRESS, paymentMethod: "PIX", items: [{ productId, quantity: 1 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    const orderId = JSON.parse(res.body).orderId as string;
    await prisma.payment.update({ where: { orderId }, data: { status: "APROVADO" } });
    await prisma.order.update({ where: { id: orderId }, data: { awaitingPayment: false } });
    // equipe é recurso do PRO (D2/API-08): ativa só para montar o STAFF
    await activateSubscription({ subscriptionId: (await prisma.subscription.findFirstOrThrow()).id, planCode: "PRO" });
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: "staff-priv@teste.com", password: "senha12345" } });
    expect(invite.statusCode).toBe(201);
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "staff-priv@teste.com", password: "senha12345" } });
    return { owner: cookie!, staff: (login.headers["set-cookie"] as string).split(";")[0], store, orderId };
  }

  it("P1 (API-54a) GET /api/orders para o DONO não devolve telefone/endereço completos nem campos internos do pagamento", async () => {
    const c = await cenario();
    const body = (await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: c.owner } })).body;
    expect(varrer(body)).toEqual([]);
  });

  it("P2 (API-54a) GET /api/orders para o STAFF também não", async () => {
    const c = await cenario();
    const body = (await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: c.staff } })).body;
    expect(varrer(body)).toEqual([]);
  });

  it("P3 (API-54a) a lista mostra o telefone só mascarado (últimos 4 dígitos) e nenhum endereço", async () => {
    const c = await cenario();
    const orders = JSON.parse((await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: c.owner } })).body).orders as Array<Record<string, unknown>>;
    expect(orders.length).toBe(1);
    const o = orders[0];
    expect(String(o.customerPhone ?? "")).not.toBe(PHONE);
    expect(String(o.customerPhone ?? "")).toMatch(/4321$/);
    expect(o.address ?? null).toBeNull();
  });

  it("P4 (controle) o pedido continua com os campos que o kanban precisa: id, código, status, total, tipo, itens", async () => {
    const c = await cenario();
    const o = (JSON.parse((await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: c.owner } })).body).orders as Array<Record<string, unknown>>)[0];
    for (const k of ["id", "code", "status", "totalCents", "type", "items"]) expect(o, `falta ${k}`).toHaveProperty(k);
  });

  it("P5 o WebSocket do painel só carrega { type, orderId } (nenhum dado do cliente)", async () => {
    const { cookie, response } = await registerStore(app);
    const store = JSON.parse(response.body).store as { id: string; slug: string };
    const cat = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).body).category.id;
    const productId = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 2500 } })).body).product.id as string;
    const socket = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn() };
    subscribe(store.id, socket as never, "OWNER");
    await app.inject({ method: "POST", url: `/stores/${store.slug}/orders`, payload: { type: "DELIVERY", customerName: "Cliente Sigiloso", customerPhone: PHONE, address: ADDRESS, paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1 }] } });
    expect(socket.send.mock.calls.length).toBeGreaterThan(0);
    for (const [raw] of socket.send.mock.calls) {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      expect(Object.keys(msg).sort().filter((k) => k !== "type" && k !== "orderId")).toEqual([]);
      expect(String(raw)).not.toContain(PHONE);
      expect(String(raw)).not.toContain("Sigilos");
    }
  });
});
