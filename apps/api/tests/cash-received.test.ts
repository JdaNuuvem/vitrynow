// API-21 — o caixa conta dinheiro RECEBIDO (Order.paidAt, RN-CX-01/02), não dinheiro "vendido".
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-21 — dinheiro recebido no caixa", () => {
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
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 4000 } })).product.id as string;
    return { owner: cookie!, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const abrir = (l: Loja, opening = 10000) => app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: l.owner }, payload: { openingBalanceCents: opening } });
  const fechar = (l: Loja, counted: number) => app.inject({ method: "POST", url: "/api/cashier/close", headers: { cookie: l.owner }, payload: { closingBalanceCents: counted, reason: "NAO_SEI" } });
  const atual = async (l: Loja) => json(await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: l.owner } }));
  async function pedido(l: Loja, paymentMethod: string, type = "BALCAO") {
    const r = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type, paymentMethod, items: [{ productId: l.productId, quantity: 1 }], ...(type === "DELIVERY" ? { customerName: "A", customerPhone: "21999990000", address: "Rua" } : {}) } });
    expect(r.statusCode, r.body).toBe(201);
    return json(r).orderId as string;
  }
  const avancar = async (l: Loja, id: string, ate: string[]) => {
    for (const to of ate) expect((await app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie: l.owner }, payload: { to } })).statusCode, to).toBe(200);
  };
  const ATE_CONCLUIR = ["CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"];
  const paidAt = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).paidAt;

  it("CONCLUIR um pedido em DINHEIRO grava paidAt UMA vez; PIX, cartão e pedido ainda aberto não gravam", async () => {
    const l = await loja();
    await abrir(l);
    const din = await pedido(l, "DINHEIRO");
    const cartao = await pedido(l, "DEBITO");
    const aberto = await pedido(l, "DINHEIRO");
    expect(await paidAt(din)).toBeNull();
    await avancar(l, din, ATE_CONCLUIR);
    await avancar(l, cartao, ATE_CONCLUIR);
    await avancar(l, aberto, ["CONFIRMADO"]);
    const t = await paidAt(din);
    expect(t).not.toBeNull();
    expect([await paidAt(cartao), await paidAt(aberto)]).toEqual([null, null]);
    expect((await atual(l)).summary.cashSalesCents).toBe(4000);
    // concluir de novo é recusado e o instante não muda
    expect((await app.inject({ method: "POST", url: `/api/orders/${din}/transition`, headers: { cookie: l.owner }, payload: { to: "CONCLUIDO" } })).statusCode).toBe(409);
    expect((await paidAt(din))?.getTime()).toBe(t?.getTime());
  });

  it("RN-CX-01: entrega pedida ANTES de abrir o caixa e paga DEPOIS entra no esperado do caixa novo; entrega concluída depois do fechamento não entra no fechado", async () => {
    const l = await loja();
    const antes = await pedido(l, "DINHEIRO", "DELIVERY"); // criada com o caixa FECHADO
    await avancar(l, antes, ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA"]);
    expect((await abrir(l, 10000)).statusCode).toBe(201);
    expect((await atual(l)).expectedBalanceCents).toBe(10000); // ainda não recebida
    await avancar(l, antes, ["CONCLUIDO"]);
    expect((await atual(l)).expectedBalanceCents).toBe(14000); // recebida DENTRO da sessão
    const depois = await pedido(l, "DINHEIRO", "DELIVERY");
    await avancar(l, depois, ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA"]);
    const fechou = await fechar(l, 14000);
    expect(fechou.statusCode, fechou.body).toBe(200);
    expect(json(fechou).session.expectedClosingCents).toBe(14000);
    await avancar(l, depois, ["CONCLUIDO"]); // recebida DEPOIS do fechamento
    const sid = json(fechou).session.id as string;
    const resumo = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${sid}/summary`, headers: { cookie: l.owner } }));
    expect(resumo.summary.expectedCents).toBe(14000); // o caixa fechado não muda
    // dinheiro recebido ENTRE dois caixas não pertence a nenhum deles (o novo só conta o que entra dentro dele)
    expect((await abrir(l, 0)).statusCode).toBe(201);
    expect((await atual(l)).expectedBalanceCents).toBe(0); // nada recebido DENTRO deste novo turno
  });

  it("total ZERO (cupom 100%) concluído em dinheiro não vira dinheiro recebido", async () => {
    const l = await loja();
    await abrir(l);
    const c = await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: l.owner }, payload: { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 5 } });
    expect(c.statusCode, c.body).toBe(201);
    const r = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", couponCode: "TUDO", items: [{ productId: l.productId, quantity: 1 }] } });
    expect(r.statusCode, r.body).toBe(201);
    const id = json(r).orderId as string;
    await avancar(l, id, ATE_CONCLUIR);
    expect(await paidAt(id)).toBeNull();
    expect((await atual(l)).expectedBalanceCents).toBe(10000);
  });

  it("ISOLAMENTO: o dinheiro recebido por uma loja não entra no caixa de outra", async () => {
    const a = await loja();
    const b = await loja();
    await abrir(a, 5000);
    await abrir(b, 5000);
    const id = await pedido(a, "DINHEIRO");
    await avancar(a, id, ATE_CONCLUIR);
    expect((await atual(a)).expectedBalanceCents).toBe(9000);
    expect((await atual(b)).expectedBalanceCents).toBe(5000);
  });

  it("AVISO DE MUDANÇA DE REGRA (RN-MIG-04b): só em caixa aberto ANTES da migração, uma vez por usuário; dispensar é idempotente; caixa novo e fechado ⇒ null", async () => {
    const l = await loja();
    const staffEmail = `s-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: l.owner }, payload: { email: staffEmail, password: "provisoria-12" } });
    const staff = ((await app.inject({ method: "POST", url: "/auth/login", payload: { email: staffEmail, password: "provisoria-12" } })).headers["set-cookie"] as string).split(";")[0];
    const vista = async (cookie: string) => json(await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie } })).ruleChangeNotice;
    expect(await vista(l.owner)).toBeNull(); // sem caixa
    await abrir(l);
    expect(await vista(l.owner)).toBeNull(); // caixa novo (versão 2)
    await prisma.cashSession.updateMany({ where: { storeId: l.store.id }, data: { cashRuleVersion: 1 } }); // como um caixa aberto na migração
    const aviso = { id: "CASH_RECEIVED_V1", text: "O cálculo do caixa mudou: agora só conta o dinheiro já recebido." };
    expect(await vista(l.owner)).toEqual(aviso);
    expect(await vista(staff)).toEqual(aviso);
    const d = () => app.inject({ method: "POST", url: "/api/cashier/notices/CASH_RECEIVED_V1/dismiss", headers: { cookie: l.owner } });
    expect((await d()).statusCode).toBe(200);
    expect((await d()).statusCode).toBe(200); // idempotente
    expect(await vista(l.owner)).toBeNull();
    expect(await vista(staff)).toEqual(aviso); // a dispensa é POR USUÁRIO
    expect((await app.inject({ method: "POST", url: "/api/cashier/notices/OUTRO/dismiss", headers: { cookie: l.owner } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/cashier/notices/CASH_RECEIVED_V1/dismiss" })).statusCode).toBe(401);
    expect(await prisma.userNoticeDismissal.count()).toBe(1);
    await fechar(l, 10000);
    expect(await vista(staff)).toBeNull(); // caixa fechado
  });

  it("cancelar pedido em andamento tira o 'a receber' sem mexer no esperado", async () => {
    const l = await loja();
    await abrir(l);
    const id = await pedido(l, "DINHEIRO", "DELIVERY");
    await avancar(l, id, ["CONFIRMADO"]);
    expect((await atual(l)).summary.toReceiveCents).toBe(4000);
    expect((await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: l.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } })).statusCode).toBe(200);
    const c = await atual(l);
    expect([c.summary.toReceiveCents, c.expectedBalanceCents]).toEqual([0, 10000]);
  });
});
