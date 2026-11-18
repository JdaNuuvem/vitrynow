// QA-23 — critérios CA-CP-01..14 do Leonardo/Atlas (leonardo/regras-cupom-e-total-zero.md): FUNC-01 (limite de uso sob corrida),
// FUNC-02 (cadastro e pedido de total zero) e FUNC-04 (teto do STAFF e desativar). Sondas do Deming (QA); todos os casos são it()
// porque as correções estão na branch. O Mercado Pago é sempre simulado.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb , useMockedProvider } from "../helpers";

vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../../src/lib/mercadopago";


describe("QA cupom: limite de uso, cadastro e pedido de total zero (CA-CP)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { vi.clearAllMocks(); useMockedProvider(mp); app = makeApp(); await app.ready(); });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qa_falha_item ON "OrderItem"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS qa_falha_item_fn()`);
    await app.close(); await resetDb();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const json = (r: { body: string }) => JSON.parse(r.body);

  async function loja(extra: { storeName?: string; slug?: string; code?: string; email?: string } = {}) {
    const { cookie, response } = await registerStore(app, extra);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 4000 } })).product.id as string;
    await app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie: cookie! }, payload: { deliveryEnabled: true, pickupEnabled: true, deliveryFeeCents: 600 } });
    return { owner: cookie!, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const cupom = (l: Loja, body: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: l.owner }, payload: body });
  const pedido = (l: Loja, extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", customerName: "Cli", customerPhone: "11987654321", paymentMethod: "DINHEIRO", items: [{ productId: l.productId, quantity: 1 }], ...extra } });
  const usos = async (code: string) => (await prisma.coupon.findFirstOrThrow({ where: { code } })).usedCount;
  const seq = async (storeId: string) => (await prisma.storeCounter.findUnique({ where: { storeId } }))?.orderSeq ?? 0;

  // ───── FUNC-01 ─────
  it("CA-CP-01 cupom maxUses=1 e 6 pedidos PARALELOS: exatamente 1×201, 5×400 COUPON_EXHAUSTED, usedCount=1 e os recusados não consomem número", async () => {
    const l = await loja();
    expect((await cupom(l, { code: "UNICO", discountType: "FIXED", discountValue: 500, maxUses: 1 })).statusCode).toBe(201);
    const antes = await seq(l.store.id);
    const rs = await Promise.all(Array.from({ length: 6 }, () => pedido(l, { couponCode: "UNICO" })));
    const ok = rs.filter((r) => r.statusCode === 201); const recusados = rs.filter((r) => r.statusCode === 400);
    const resumo = rs.map((r) => r.statusCode).join(",");
    expect(ok.length, resumo).toBe(1);
    expect(recusados.length, resumo).toBe(5);
    for (const r of recusados) expect(json(r).code).toBe("COUPON_EXHAUSTED");
    expect(await usos("UNICO")).toBe(1);
    expect(await seq(l.store.id), "os 5 recusados não podem consumir número de pedido").toBe(antes + 1);
  });

  it("CA-CP-02 falha no meio da criação do pedido: nem o pedido nem o uso do cupom ficam gravados (nunca desconto sem contar)", async () => {
    const l = await loja();
    await cupom(l, { code: "MEIO", discountType: "FIXED", discountValue: 500, maxUses: 5 });
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION qa_falha_item_fn() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'QA: falha simulada ao gravar o item'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_falha_item BEFORE INSERT ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION qa_falha_item_fn()`);
    const antes = await seq(l.store.id);
    const r = await pedido(l, { couponCode: "MEIO" });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.order.count({ where: { storeId: l.store.id } })).toBe(0);
    expect(await usos("MEIO"), "uso contado sem pedido").toBe(0);
    expect(await seq(l.store.id)).toBe(antes);
  });

  // ───── FUNC-02: cadastro ─────
  it("CA-CP-03 percentual: 150 ⇒ 400 COUPON_VALUE_INVALID; 100 sem maxUses ⇒ 400 COUPON_NEEDS_LIMIT; 100 com maxUses ⇒ 201; 0 e negativo ⇒ 400", async () => {
    const l = await loja();
    const a = await cupom(l, { code: "CENTO50", discountType: "PERCENT", discountValue: 150, maxUses: 5 });
    const b = await cupom(l, { code: "CEM", discountType: "PERCENT", discountValue: 100 });
    const c = await cupom(l, { code: "CEMOK", discountType: "PERCENT", discountValue: 100, maxUses: 10 });
    const d = await cupom(l, { code: "ZERO", discountType: "PERCENT", discountValue: 0 });
    const e = await cupom(l, { code: "NEG", discountType: "PERCENT", discountValue: -5 });
    expect([a.statusCode, json(a).code]).toEqual([400, "COUPON_VALUE_INVALID"]);
    expect([b.statusCode, json(b).code]).toEqual([400, "COUPON_NEEDS_LIMIT"]);
    expect(c.statusCode).toBe(201);
    expect(d.statusCode).toBe(400);
    expect(e.statusCode).toBe(400);
  });

  it("CA-CP-04 fixo ≤ 0 ⇒ 400; código com espaço, acento ou 2 caracteres ⇒ 400; repetido na loja ⇒ 409 COUPON_CODE_TAKEN; o mesmo código em OUTRA loja é aceito", async () => {
    const l = await loja(); const outra = await loja({ storeName: "Outra", slug: "outra-loja", code: "OL", email: "outra@teste.com" });
    const ruins = [{ code: "AB", discountType: "FIXED", discountValue: 100 }, { code: "COM ESPACO", discountType: "FIXED", discountValue: 100 }, { code: "AÇAÍ10", discountType: "FIXED", discountValue: 100 }, { code: "ZEROFIXO", discountType: "FIXED", discountValue: 0 }, { code: "NEGFIXO", discountType: "FIXED", discountValue: -100 }];
    for (const r of ruins) expect((await cupom(l, r)).statusCode, JSON.stringify(r)).toBe(400);
    expect((await cupom(l, { code: "REPETE", discountType: "FIXED", discountValue: 100 })).statusCode).toBe(201);
    const dup = await cupom(l, { code: "repete", discountType: "FIXED", discountValue: 100 });
    expect([dup.statusCode, json(dup).code]).toEqual([409, "COUPON_CODE_TAKEN"]);
    expect((await cupom(outra, { code: "REPETE", discountType: "FIXED", discountValue: 100 })).statusCode).toBe(201);
  });

  // ───── Condição da Nightingale (FUNC-02 item 2): STAFF não cria "quase comida de graça" sem controle ─────
  it("CA-CP-13 (Nightingale/Atlas) teto do STAFF: PERCENT ≤ 50, FIXO ≤ R$ 50,00 e maxUses obrigatório ≤ 500 (sobre o valor FINAL); acima disso 403 FORBIDDEN_ROLE; o OWNER cria", async () => {
    const l = await loja();
    await prisma.subscription.updateMany({ where: { storeId: l.store.id }, data: { planId: "plan_pro", status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 30 * 86400000) } });
    const inv = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: l.owner }, payload: { email: "staff-cupom@teste.com", password: "senha-staff-12345" } });
    expect(inv.statusCode, inv.body).toBe(201);
    const lg = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "staff-cupom@teste.com", password: "senha-staff-12345" } });
    const staff = (lg.headers["set-cookie"] as string).split(";")[0];
    const comoStaff = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: staff }, payload: body });
    const status = async (body: Record<string, unknown>) => (await comoStaff(body)).statusCode;
    // dentro do teto: 201
    expect(await status({ code: "S50PCT", discountType: "PERCENT", discountValue: 50, maxUses: 100 })).toBe(201);
    expect(await status({ code: "S50FIXO", discountType: "FIXED", discountValue: 5000, maxUses: 500 })).toBe(201);
    // acima do teto (valor, percentual ou limite) ou sem limite: 403
    expect(await status({ code: "S51PCT", discountType: "PERCENT", discountValue: 51, maxUses: 100 }), "PERCENT 51").toBe(403);
    expect(await status({ code: "S5001", discountType: "FIXED", discountValue: 5001, maxUses: 100 }), "FIXO R$ 50,01").toBe(403);
    expect(await status({ code: "SENORME", discountType: "FIXED", discountValue: 999_900, maxUses: 100 }), "FIXO R$ 9.999").toBe(403);
    expect(await status({ code: "SSEMLIM", discountType: "PERCENT", discountValue: 10 }), "sem maxUses").toBe(403);
    expect(await status({ code: "SLIM501", discountType: "PERCENT", discountValue: 10, maxUses: 501 }), "maxUses 501").toBe(403);
    // editar não burla: subir um cupom permitido acima do teto ou tirar o limite
    const id = JSON.parse((await app.inject({ method: "GET", url: "/api/coupons", headers: { cookie: staff } })).body).coupons.find((c: { code: string }) => c.code === "S50PCT").id as string;
    const edita = (body: Record<string, unknown>) => app.inject({ method: "POST", url: `/api/coupons/${id}`, headers: { cookie: staff }, payload: body });
    expect((await edita({ discountValue: 99 })).statusCode, "editar para 99%").toBe(403);
    expect((await edita({ discountType: "FIXED", discountValue: 999_900 })).statusCode, "trocar de tipo para fixo enorme").toBe(403);
    // o dono não tem o teto
    expect((await cupom(l, { code: "DONO99", discountType: "PERCENT", discountValue: 99 })).statusCode).toBe(201);
  });

  it("CA-CP-14 (Atlas) STAFF DESATIVA (active=false) cupom do dono acima do teto ⇒ 200; REATIVAR ⇒ 403; desativar e mudar outro campo no mesmo pedido ⇒ 403", async () => {
    const l = await loja();
    await prisma.subscription.updateMany({ where: { storeId: l.store.id }, data: { planId: "plan_pro", status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 30 * 86400000) } });
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: l.owner }, payload: { email: "staff-cupom2@teste.com", password: "senha-staff-12345" } });
    const lg = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "staff-cupom2@teste.com", password: "senha-staff-12345" } });
    const staff = (lg.headers["set-cookie"] as string).split(";")[0];
    const grande = json(await cupom(l, { code: "GRANDE", discountType: "PERCENT", discountValue: 90, maxUses: 1000 })).coupon.id as string;
    const patch = (body: Record<string, unknown>) => app.inject({ method: "POST", url: `/api/coupons/${grande}`, headers: { cookie: staff }, payload: body });
    expect((await patch({ active: false })).statusCode, "STAFF desativa cupom perigoso").toBe(200);
    expect((await patch({ active: true })).statusCode, "STAFF reativa cupom acima do teto").toBe(403);
    expect((await patch({ active: false, discountValue: 10 })).statusCode, "desativar + editar outro campo").toBe(403);
    expect((await patch({ active: false, expiresAt: new Date(Date.now() + 86_400_000).toISOString() })).statusCode, "desativar + validade (Nightingale)").toBe(403);
    expect((await patch({ active: false })).statusCode, "desativar cupom já inativo é idempotente").toBe(200);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: grande } })).active).toBe(false);
  });

  // ───── FUNC-02: total zero ─────
  it("CA-CP-05 retirada com cupom 100% (total 0): nenhuma cobrança no provedor, sem awaitingPayment e sem QR mesmo com paymentMethod=PIX", async () => {
    const l = await loja();
    await cupom(l, { code: "GRATIS", discountType: "PERCENT", discountValue: 100, maxUses: 5 });
    const r = await pedido(l, { couponCode: "GRATIS", paymentMethod: "PIX" });
    expect(r.statusCode, r.body).toBe(201);
    expect(vi.mocked(mp.createPixPayment), "o gateway NÃO pode ser chamado para total zero").not.toHaveBeenCalled();
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(r).orderId }, include: { payment: true } });
    expect(o.totalCents).toBe(0);
    expect(o.awaitingPayment).toBe(false);
    expect(o.payment).toBeNull();
    expect(o.paymentMethod, "forma informada é ignorada (RN-CP-11)").toBeNull();
    // só as CHAVES da resposta: o token do pedido (NG-16) é aleatório e pode conter "qr"/"pix" por acaso
    expect(Object.keys(json(r)).filter((k) => /qr|pix/i.test(k)), "a resposta de total zero não traz QR nem PIX").toEqual([]);
  });

  it("CA-CP-06 entrega com taxa R$ 6,00 e cupom 100%: total R$ 6,00 (cupom não desconta a taxa) e o PIX de R$ 6,00 é criado normalmente", async () => {
    const l = await loja();
    await cupom(l, { code: "GRATIS", discountType: "PERCENT", discountValue: 100, maxUses: 5 });
    vi.mocked(mp.createPixPayment).mockResolvedValue({ providerPaymentId: "mp-cp06", status: "pending", pixQrCode: "000201", pixQrCodeBase64: "QQ==", expiresAt: new Date(Date.now() + 600_000) });
    const r = await pedido(l, { type: "DELIVERY", address: "Rua A, 1", couponCode: "GRATIS", paymentMethod: "PIX" });
    expect(r.statusCode, r.body).toBe(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(r).orderId } });
    expect(o.totalCents).toBe(600);
    expect(vi.mocked(mp.createPixPayment).mock.calls[0][0].amountCents).toBe(600);
  });

  it("CA-CP-09 cancelar pedido de total zero: sem estorno, sem linha de dinheiro, cupom volta UMA vez (repetir não devolve de novo)", async () => {
    const l = await loja();
    await cupom(l, { code: "GRATIS", discountType: "PERCENT", discountValue: 100, maxUses: 5 });
    const r = await pedido(l, { couponCode: "GRATIS" });
    expect(r.statusCode, r.body).toBe(201);
    const id = json(r).orderId as string;
    expect(await usos("GRATIS")).toBe(1);
    const c1 = await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: l.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: l.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect(c1.statusCode, c1.body).toBe(200);
    expect(vi.mocked(mp.refundPayment)).not.toHaveBeenCalled();
    expect(json(c1).refund ?? "NONE").toBe("NONE");
    expect(await usos("GRATIS")).toBe(0);
  });

  it("CA-CP-11 o desconto incide só sobre os itens: FIXO de R$ 50,00 em itens de R$ 30,00 desconta R$ 30,00 (taxa e gorjeta fora da base)", async () => {
    const l = await loja();
    const cat = (await prisma.category.findFirstOrThrow({ where: { storeId: l.store.id } })).id;
    const barato = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: l.owner }, payload: { categoryId: cat, name: "Barato", priceCents: 3000 } })).product.id as string;
    await cupom(l, { code: "CINQUENTA", discountType: "FIXED", discountValue: 5000 });
    const r = await pedido(l, { type: "DELIVERY", address: "Rua A, 1", items: [{ productId: barato, quantity: 1 }], couponCode: "CINQUENTA", tipCents: 200, paymentMethod: "DINHEIRO" });
    expect(r.statusCode, r.body).toBe(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(r).orderId } });
    expect(o.discountCents).toBe(3000);
    expect(o.totalCents).toBe(600 + 200); // taxa 6,00 + gorjeta 2,00; os itens ficaram a R$ 0,00
  });
});
