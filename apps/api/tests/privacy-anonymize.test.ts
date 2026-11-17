// API-52 (LGPD, ADR-0014 §3.1; spec do Leonardo RN-PV-01..10, CA-PV-01..05 e 11): anonimizar cliente SEM destruir o financeiro.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { sendMfaCodeEmail } from "../src/lib/email";
import { login, makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/email", () => ({
  sendPasswordResetEmail: vi.fn(),
  sendMfaCodeEmail: vi.fn(),
}));
vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const PHONE = "11987654321";
const NOME = "Maria Conceição Silva";
const RUA = "Rua das Acácias, 1234, apto 56";
const OBS = "alergia a amendoim, portão azul";
const NOTA = "cliente VIP, ligar antes";
const DAY = 24 * 3_600_000;

describe("privacidade: anonimizar cliente", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    delete process.env.MFA_ENFORCED;
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  let seq = 0;

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const invited = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: `staff-pv-${Date.now()}-${seq++}@t.com`, password: "provisoria1" } });
    const staff = (await login(app, json(invited).user.email, "provisoria1")).cookie!;
    return { owner: cookie!, staff, storeId };
  }

  async function mk(storeId: string, data: { status?: "CONCLUIDO" | "CANCELADO" | "PENDENTE" | "EM_PREPARO"; phone?: string | null; name?: string | null; ago?: number; total?: number; payment?: "PIX" | "DINHEIRO"; awaiting?: boolean } = {}) {
    seq += 1;
    const createdAt = new Date(Date.now() - (data.ago ?? 0));
    const order = await prisma.order.create({
      data: {
        storeId, code: `V${String(seq).padStart(4, "0")}`, type: "DELIVERY", status: data.status ?? "CONCLUIDO",
        customerName: data.name === undefined ? NOME : data.name, customerPhone: data.phone === undefined ? PHONE : data.phone,
        address: RUA, notes: OBS, internalNote: NOTA, totalCents: data.total ?? 2500, subtotalCents: data.total ?? 2500, paymentMethod: data.payment ?? "DINHEIRO",
        awaitingPayment: data.awaiting ?? false, createdAt, updatedAt: createdAt,
        items: { create: [{ productName: "Pizza", quantity: 1, unitPriceCents: data.total ?? 2500, notes: "sem cebola para a Maria" }] },
      },
    });
    await prisma.orderStatusHistory.create({ data: { orderId: order.id, status: data.status ?? "CONCLUIDO", createdAt: new Date(createdAt.getTime() + 600_000) } });
    return order.id;
  }

  const preview = (cookie: string, body: object) => app.inject({ method: "POST", url: "/api/privacy/anonymize/preview", headers: { cookie }, payload: body });
  const run = (cookie: string, body: object, headers: Record<string, string> = {}) => app.inject({ method: "POST", url: "/api/privacy/anonymize", headers: { cookie, ...headers }, payload: body });
  const summary = async (cookie: string) => json(await app.inject({ method: "GET", url: `/api/reports/summary?from=2020-01-01&to=${new Date(Date.now() + DAY).toISOString().slice(0, 10)}`, headers: { cookie } })); // `to` fixo: o campo `to` devolvido é o relógio da consulta

  it("CA-PV-01: 7 encerrados + 1 em aberto ⇒ BLOQUEIA citando o aberto; depois de concluir, anonimiza os 8", async () => {
    const ctx = await setup();
    for (let i = 0; i < 7; i++) await mk(ctx.storeId, { ago: (i + 1) * DAY });
    const aberto = await mk(ctx.storeId, { status: "EM_PREPARO", ago: 60_000 });
    const codigoAberto = (await prisma.order.findUniqueOrThrow({ where: { id: aberto } })).code;

    const prev = json(await preview(ctx.owner, { phone: PHONE }));
    expect(prev).toMatchObject({ orders: 8, blocked: true, blockers: [{ code: codigoAberto, status: "EM_PREPARO", reason: "OPEN" }], phoneMasked: "*******4321" });
    const bloqueado = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 8 });
    expect(bloqueado.statusCode).toBe(409);
    expect(json(bloqueado)).toMatchObject({ code: "OPEN_ORDERS", orders: [{ code: codigoAberto }] });
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })).toBe(0); // nada foi tocado

    await prisma.order.update({ where: { id: aberto }, data: { status: "CONCLUIDO" } });
    const ok = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 8 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json(ok)).toEqual({ anonymized: 8, nothingToRemove: false });
  });

  it("RN-PV-03: some TUDO o que é pessoal (nome, telefone, endereço, observações, nota interna, observação dos itens); FICA o financeiro e o resto", async () => {
    const ctx = await setup();
    const id = await mk(ctx.storeId, { total: 4321 });
    const antes = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect((await run(ctx.owner, { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 })).statusCode).toBe(200);
    const depois = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true, statusHistory: true } });
    expect(depois).toMatchObject({ customerName: null, customerPhone: null, address: null, notes: null, internalNote: null });
    expect(depois.anonymizedAt).toBeInstanceOf(Date);
    expect(depois.items[0].notes).toBeNull();
    // o que FICA, idêntico
    for (const campo of ["code", "type", "status", "totalCents", "subtotalCents", "discountCents", "deliveryFeeCents", "tipCents", "paymentMethod", "createdAt"] as const) {
      expect(depois[campo], campo).toEqual(antes[campo]);
    }
    expect(depois.items[0]).toMatchObject({ productName: "Pizza", quantity: 1, unitPriceCents: 4321 });
    expect(depois.statusHistory).toHaveLength(1);
    expect(depois.updatedAt.getTime()).toBe(antes.updatedAt.getTime()); // anonimizar não é atividade do pedido
  });

  it("CA-PV-02: faturamento, pedidos, ticket médio, por forma de pagamento e por dia são IDÊNTICOS antes e depois; só 'clientes distintos' diminui", async () => {
    const ctx = await setup();
    for (let i = 0; i < 4; i++) await mk(ctx.storeId, { ago: (i + 1) * DAY, total: 1000 + i * 100, payment: i % 2 ? "PIX" : "DINHEIRO" });
    await mk(ctx.storeId, { ago: DAY, phone: "21999990000", name: "Outro Cliente", total: 3000 }); // outra pessoa: não pode mudar
    const antes = await summary(ctx.owner);
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 4 })).statusCode).toBe(200);
    const depois = await summary(ctx.owner);
    const { customerCount: cAntes, ...restoAntes } = antes;
    const { customerCount: cDepois, ...restoDepois } = depois;
    expect(restoDepois).toEqual(restoAntes);
    expect(cAntes).toBe(2);
    expect(cDepois).toBe(1); // RN-PV-05: a pessoa removida deixa de ser contada; o outro cliente continua
  });

  it("CA-PV-03: depois de anonimizar a busca por telefone e por nome NÃO acha; a lista e o detalhe não trazem o dado e marcam `anonymized`", async () => {
    const ctx = await setup();
    const id = await mk(ctx.storeId);
    await mk(ctx.storeId, { phone: "21999990000", name: "Outro Cliente" });
    const achaAntes = json(await app.inject({ method: "GET", url: `/api/orders/history?q=${PHONE}`, headers: { cookie: ctx.owner } }));
    expect(achaAntes.rows.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 })).statusCode).toBe(200);
    for (const q of [PHONE, "4321", "Maria", "conceicao", "Acácias"]) {
      const res = json(await app.inject({ method: "GET", url: `/api/orders/history?q=${encodeURIComponent(q)}`, headers: { cookie: ctx.owner } }));
      expect(res.rows.map((r: { id: string }) => r.id), q).not.toContain(id);
    }
    const lista = json(await app.inject({ method: "GET", url: "/api/orders/history", headers: { cookie: ctx.owner } })).rows as { id: string; anonymized: boolean; customerName: string | null; hasPhone: boolean }[];
    expect(lista.find((r) => r.id === id)).toMatchObject({ anonymized: true, customerName: null, hasPhone: false });
    expect(lista.find((r) => r.id !== id)).toMatchObject({ anonymized: false });
    const detalhe = (await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: ctx.owner } })).body;
    for (const dado of [PHONE, NOME, "Acácias", OBS, NOTA, "sem cebola"]) expect(detalhe, dado).not.toContain(dado);
    expect(json({ body: detalhe }).order).toMatchObject({ anonymized: true, customerName: null, customerPhone: null, address: null });
  });

  it("CA-PV-04: STAFF recebe 403 FORBIDDEN_ROLE (prévia e execução); sem sessão, 401; OWNER sem MFA válida (ativa) recebe MFA_REQUIRED e nada muda", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    for (const [url, body] of [["/api/privacy/anonymize/preview", { phone: PHONE }], ["/api/privacy/anonymize", { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 }]] as const) {
      const res = await app.inject({ method: "POST", url, headers: { cookie: ctx.staff }, payload: body });
      expect(res.statusCode, url).toBe(403);
      expect(json(res).code, url).toBe("FORBIDDEN_ROLE");
      expect((await app.inject({ method: "POST", url, payload: body })).statusCode, `${url} sem sessão`).toBe(401);
    }
    process.env.MFA_ENFORCED = "true";
    const semMfa = await run(ctx.owner, { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 });
    expect(semMfa.statusCode).toBe(403);
    expect(json(semMfa)).toMatchObject({ code: "MFA_REQUIRED", purpose: "anonymize_customer" });
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })).toBe(0);

    // com a prova verificada para ESTA ação, passa (uso único)
    const desafio = json(await app.inject({ method: "POST", url: "/api/mfa/challenge", headers: { cookie: ctx.owner }, payload: { purpose: "anonymize_customer" } }));
    const code = vi.mocked(sendMfaCodeEmail).mock.calls.at(-1)![0].code;
    expect((await app.inject({ method: "POST", url: "/api/mfa/verify", headers: { cookie: ctx.owner }, payload: { challengeId: desafio.challengeId, code } })).statusCode).toBe(200);
    const ok = await run(ctx.owner, { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 }, { "x-mfa-challenge": desafio.challengeId });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json(await run(ctx.owner, { phone: PHONE, reason: "STORE_DECISION", expectedOrders: 1 }, { "x-mfa-challenge": desafio.challengeId })).code).toBe("MFA_REQUIRED"); // a prova não vale duas vezes
  });

  it("a confirmação repete o efeito: `expectedOrders` diferente da prévia ⇒ 409 COUNT_CHANGED e nada é feito", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    await mk(ctx.storeId);
    const res = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: "COUNT_CHANGED", orders: 2 });
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, anonymizedAt: { not: null } } })).toBe(0);
  });

  it("só pedido ENCERRADO: PIX não pago e estorno pendente também bloqueiam; cancelado entra", async () => {
    const ctx = await setup();
    const cancelado = await mk(ctx.storeId, { status: "CANCELADO" });
    const pix = await mk(ctx.storeId, { status: "PENDENTE", awaiting: true, payment: "PIX" });
    const bloqueio = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 2 });
    expect(bloqueio.statusCode).toBe(409);
    expect(json(bloqueio).orders).toHaveLength(1); // o PIX aguardando
    await prisma.order.update({ where: { id: pix }, data: { status: "CANCELADO", awaitingPayment: false } });
    await prisma.payment.create({ data: { orderId: cancelado, amountCents: 2500, status: "ESTORNO_PENDENTE" } });
    const estorno = await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 2 });
    expect(estorno.statusCode).toBe(409);
    expect(json(estorno).orders).toEqual([expect.objectContaining({ reason: "REFUND_PENDING" })]);
    await prisma.payment.update({ where: { orderId: cancelado }, data: { status: "REEMBOLSADO" } });
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 2 })).statusCode).toBe(200);
  });

  it("RN-PV-07 e idempotência: segunda chamada e pedido sem dado pessoal respondem 'nada a remover' sem gravar nada; busca por CÓDIGO funciona", async () => {
    const ctx = await setup();
    const semDado = await mk(ctx.storeId, { phone: null, name: null });
    await prisma.order.update({ where: { id: semDado }, data: { address: null, notes: null, internalNote: null } });
    await prisma.orderItem.updateMany({ where: { orderId: semDado }, data: { notes: null } });
    const codigo = (await prisma.order.findUniqueOrThrow({ where: { id: semDado } })).code;
    expect(json(await preview(ctx.owner, { orderCode: codigo }))).toMatchObject({ orders: 0, nothingToRemove: true, blocked: false });
    expect(json(await run(ctx.owner, { orderCode: codigo, reason: "HOLDER_REQUEST", expectedOrders: 1 }))).toEqual({ anonymized: 0, nothingToRemove: true });

    const comDado = await mk(ctx.storeId);
    const cod2 = (await prisma.order.findUniqueOrThrow({ where: { id: comDado } })).code;
    expect(json(await run(ctx.owner, { orderCode: cod2.replace(/^V0*/, ""), reason: "HOLDER_REQUEST", expectedOrders: 1 }))).toMatchObject({ anonymized: 0 }); // "V…" não é só número: não casa por zeros
    expect(json(await run(ctx.owner, { orderCode: cod2, reason: "HOLDER_REQUEST", expectedOrders: 1 }))).toEqual({ anonymized: 1, nothingToRemove: false });
    expect(json(await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 }))).toEqual({ anonymized: 0, nothingToRemove: true }); // já anonimizado
    expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "privacy.anonymize_customer" } })).toBe(1); // só a execução real grava
  });

  it("telefone com formatação e com código do país (55) acham a mesma pessoa; outra pessoa e outra LOJA não são tocadas", async () => {
    const a = await setup();
    const b = await setup();
    const alvo = await mk(a.storeId, { phone: "(11) 98765-4321" });
    const comPais = await mk(a.storeId, { phone: "+55 11 98765-4321" });
    const outro = await mk(a.storeId, { phone: "11987654322", name: "Outra Pessoa" });
    const deB = await mk(b.storeId); // MESMO telefone, em outra loja
    expect(json(await preview(a.owner, { phone: "5511987654321" })).orders).toBe(2);
    expect((await run(a.owner, { phone: "11 98765-4321", reason: "HOLDER_REQUEST", expectedOrders: 2 })).statusCode).toBe(200);
    const estado = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).anonymizedAt !== null;
    expect([await estado(alvo), await estado(comPais), await estado(outro), await estado(deB)]).toEqual([true, true, false, false]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: deB } })).customerPhone).toBe(PHONE); // a loja B segue intacta
  });

  it("validação: sem alvo, com os dois alvos, telefone curto e motivo fora da lista ⇒ 400; motivo livre nunca entra", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    for (const body of [{}, { phone: PHONE, orderCode: "V0001" }, { orderCode: "" }]) expect((await preview(ctx.owner, body)).statusCode, JSON.stringify(body)).toBe(400);
    for (const body of [
      { phone: PHONE, reason: "porque sim", expectedOrders: 1 },
      { phone: PHONE, expectedOrders: 1 },
      { phone: PHONE, reason: "HOLDER_REQUEST" },
      { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 0 },
      { phone: "12345", reason: "HOLDER_REQUEST", expectedOrders: 1 },
    ]) expect((await run(ctx.owner, body)).statusCode, JSON.stringify(body)).toBe(400);
  });

  it("auditoria: a execução grava quantidade, período e motivo SEM o dado removido; e `feedback` e `store.settings_update` não guardam texto (CA-PV-11, varredura)", async () => {
    const ctx = await setup();
    await mk(ctx.storeId);
    const SEGREDO_FEEDBACK = "meu telefone 11955554444 e o cliente Joaquim Pereira reclamou";
    expect((await app.inject({ method: "POST", url: "/api/feedback", headers: { cookie: ctx.owner }, payload: { message: SEGREDO_FEEDBACK } })).statusCode).toBe(201);
    const ajuste = await app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie: ctx.owner }, payload: { address: "Av. Brasil 100, Centro", whatsapp: "11944443333" } });
    expect([200, 404], ajuste.body).toContain(ajuste.statusCode);
    expect((await run(ctx.owner, { phone: PHONE, reason: "HOLDER_REQUEST", expectedOrders: 1 })).statusCode).toBe(200);

    await vi.waitFor(async () => {
      const acoes = (await prisma.auditLog.findMany({ where: { storeId: ctx.storeId } })).map((l) => l.action);
      expect(acoes).toEqual(expect.arrayContaining(["feedback.sent", "privacy.anonymize_customer"]));
    });
    const todas = JSON.stringify(await prisma.auditLog.findMany({ where: { storeId: ctx.storeId } }));
    for (const dado of [PHONE, "98765", NOME, "Maria", RUA, "Acácias", OBS, NOTA, SEGREDO_FEEDBACK, "Joaquim", "11955554444", "Av. Brasil", "11944443333"]) expect(todas, `AuditLog vazou: ${dado}`).not.toContain(dado);
    const anon = await prisma.auditLog.findFirstOrThrow({ where: { storeId: ctx.storeId, action: "privacy.anonymize_customer" } });
    expect(anon.metadata).toMatchObject({ orders: 1, by: "PHONE", reason: "HOLDER_REQUEST" });
    // o texto do feedback existe, mas na tabela PRÓPRIA
    expect((await prisma.feedback.findMany({ where: { storeId: ctx.storeId } })).map((f) => f.message)).toEqual([SEGREDO_FEEDBACK]);
  });
});
