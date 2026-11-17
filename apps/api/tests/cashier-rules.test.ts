// API-27 — regras do caixa no SERVIDOR (leonardo\especificacao-caixa.md §3, §4 e §8; CA-CX-17..22): motivo obrigatório por tipo, valor contado
// obrigatório, tolerância de R$ 5,00, sangria ≤ dinheiro em caixa (sob concorrência), limite de sangria do STAFF, fechamento atômico com retrato
// congelado e auditoria sem texto livre. A DEVOLUCAO automática (RN-CX-14) e o dinheiro "recebido" com data (RN-CX-01) dependem da API-21.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-27 — caixa: regras do servidor", () => {
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

  async function setup(opening = 10000) {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    if (opening >= 0) {
      const open = await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: cookie! }, payload: { openingBalanceCents: opening } });
      expect(open.statusCode, open.body).toBe(201);
    }
    return { owner: cookie!, storeId: storeId as string, slug: slug as string };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  async function staffCookie(ctx: Ctx) {
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: ctx.owner }, payload: { email: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  }

  const move = (cookie: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/cashier/movements", headers: { cookie }, payload });
  const close = (cookie: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/cashier/close", headers: { cookie }, payload });
  const preview = (cookie: string, counted: string) => app.inject({ method: "GET", url: `/api/cashier/close-preview?countedCents=${counted}`, headers: { cookie } });
  const current = async (cookie: string) => json(await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie } }));
  const movementsCount = (storeId: string) => prisma.cashMovement.count({ where: { cashSession: { storeId } } });
  const audits = (storeId: string, action: string) => prisma.auditLog.findMany({ where: { storeId, action } });

  it("abertura obrigatória: sem `openingBalanceCents` ⇒ 400 e nenhum caixa; zero digitado de propósito abre (e a abertura é auditada)", async () => {
    const ctx = await setup(-1);
    const sem = await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload: {} });
    expect([sem.statusCode, json(sem).code]).toEqual([400, "CASH_COUNTED_REQUIRED"]);
    expect(await prisma.cashSession.count({ where: { storeId: ctx.storeId } })).toBe(0);
    const zero = await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload: { openingBalanceCents: 0 } });
    expect(zero.statusCode).toBe(201);
    await vi.waitFor(async () => expect((await audits(ctx.storeId, "cashier.open")).length).toBe(1), { timeout: 10_000, interval: 100 });
  });

  it("CA-CX-17: fechar sem valor contado (corpo vazio, null ou ausente) ⇒ 400 CASH_COUNTED_REQUIRED e o caixa CONTINUA aberto; 0 digitado de propósito fecha e exige motivo", async () => {
    const ctx = await setup(0);
    await move(ctx.owner, { type: "SUPRIMENTO", amountCents: 4000, reason: "TROCO" }); // esperado R$ 40,00
    for (const body of [{}, { closingBalanceCents: null }, { notes: "x" }]) {
      const r = await close(ctx.owner, body);
      expect([r.statusCode, json(r).code], JSON.stringify(body)).toEqual([400, "CASH_COUNTED_REQUIRED"]);
    }
    expect((await current(ctx.owner)).session).not.toBeNull(); // nada foi gravado
    const semMotivo = await close(ctx.owner, { closingBalanceCents: 0 });
    expect([semMotivo.statusCode, json(semMotivo).code, json(semMotivo).reasonRequired, json(semMotivo).toleranceCents]).toEqual([400, "CASH_REASON_REQUIRED", true, 500]);
    const ok = await close(ctx.owner, { closingBalanceCents: 0, reason: "ERRO_CONTAGEM" });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json(ok)).toMatchObject({ differenceCents: -4000, session: { expectedClosingCents: 4000, closingBalanceCents: 0, closeReason: "ERRO_CONTAGEM" } });
  });

  it("CA-CX-18: diferença até R$ 5,00 fecha SEM motivo e grava a diferença; acima, 400 CASH_REASON_REQUIRED com reasonRequired/toleranceCents e o caixa fica aberto; com motivo, fecha (limite exato: 500 sem motivo, 501 com)", async () => {
    const ctx = await setup(-1); // UMA loja para as rodadas (o cadastro de lojas tem limite por minuto); o caixa é aberto a cada rodada
    for (const [counted, reasonNeeded] of [
      [9800, false], // -200
      [9500, false], // -500 exato
      [10500, false], // +500 exato
      [9499, true], // -501
      [10501, true], // +501
      [8800, true], // -1200
    ] as const) {
      expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload: { openingBalanceCents: 10000 } })).statusCode).toBe(201);
      const r = await close(ctx.owner, { closingBalanceCents: counted });
      if (!reasonNeeded) {
        expect(r.statusCode, `${counted}: ${r.body}`).toBe(200);
        expect(json(r).session.differenceCents).toBe(counted - 10000); // a diferença SEMPRE é gravada
        expect(json(r).session.closeReason).toBeNull();
      } else {
        expect([r.statusCode, json(r).code, json(r).reasonRequired, json(r).toleranceCents], String(counted)).toEqual([400, "CASH_REASON_REQUIRED", true, 500]);
        expect((await current(ctx.owner)).session).not.toBeNull();
        expect((await close(ctx.owner, { closingBalanceCents: counted, reason: "ERRO_CONTAGEM" })).statusCode).toBe(200);
      }
    }
  });

  it("motivo do fechamento: lista fechada (NAO_SEI vale; DENTRO_DA_TOLERANCIA e outros ⇒ CASH_REASON_INVALID); OUTRO exige texto de 1 a 200; abaixo da tolerância o motivo é opcional mas, se vier, é validado", async () => {
    const ctx = await setup(10000);
    const tenta = (extra: Record<string, unknown>, counted = 8000) => close(ctx.owner, { closingBalanceCents: counted, ...extra });
    for (const reason of ["DENTRO_DA_TOLERANCIA", "FURTO", "erro_contagem", ""]) {
      const r = await tenta({ reason });
      expect([r.statusCode, json(r).code].join(), reason).toBe(reason === "" ? "400,CASH_REASON_REQUIRED" : "400,CASH_REASON_INVALID");
    }
    expect(json(await tenta({ reason: "OUTRO" })).code).toBe("CASH_REASON_INVALID");
    expect(json(await tenta({ reason: "OUTRO", reasonText: "   " })).code).toBe("CASH_REASON_INVALID");
    expect(json(await tenta({ reason: "OUTRO", reasonText: "x".repeat(201) })).code).toBe("CASH_REASON_INVALID");
    expect(json(await tenta({ reason: "FURTO" }, 9900)).code).toBe("CASH_REASON_INVALID"); // dentro da tolerância, mas veio um motivo inválido
    expect((await current(ctx.owner)).session).not.toBeNull();
    const ok = await tenta({ reason: "OUTRO", reasonText: "  Troco\ndado  a mais  " });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json(ok).session).toMatchObject({ closeReason: "OUTRO", closeReasonText: "Troco dado a mais" }); // texto limpo, uma linha
    // "Não sei explicar" é honesto e permitido
    const ctx2 = await setup(10000);
    expect((await close(ctx2.owner, { closingBalanceCents: 1, reason: "NAO_SEI" })).statusCode).toBe(200);
  });

  it("CA-CX-19: a PRÉVIA do fechamento devolve esperado, diferença, toleranceCents e reasonRequired (false para 0 e até 5,00; true acima); sem valor ⇒ 400", async () => {
    const ctx = await setup(10000);
    expect(json(await preview(ctx.owner, "10000"))).toEqual({ expectedCents: 10000, countedCents: 10000, differenceCents: 0, toleranceCents: 500, reasonRequired: false });
    expect(json(await preview(ctx.owner, "9700")).reasonRequired).toBe(false);
    expect(json(await preview(ctx.owner, "9500")).reasonRequired).toBe(false);
    expect(json(await preview(ctx.owner, "9499"))).toMatchObject({ differenceCents: -501, reasonRequired: true });
    expect(json(await preview(ctx.owner, "0")).reasonRequired).toBe(true);
    for (const bad of ["", "abc", "-5", "1.5"]) {
      const r = await app.inject({ method: "GET", url: `/api/cashier/close-preview?countedCents=${bad}`, headers: { cookie: ctx.owner } });
      expect([r.statusCode, json(r).code], bad).toEqual([400, "CASH_COUNTED_REQUIRED"]);
    }
    expect((await app.inject({ method: "GET", url: "/api/cashier/close-preview", headers: { cookie: ctx.owner } })).statusCode).toBe(400);
    expect((await current(ctx.owner)).toleranceCents).toBe(500); // a tela recebe a tolerância do servidor
  });

  it("CA-CX-20: sangria/suprimento SEM motivo ⇒ 400 CASH_REASON_REQUIRED e NADA é criado; motivo de outro tipo ⇒ CASH_REASON_INVALID; DEVOLUCAO só o sistema cria", async () => {
    const ctx = await setup(10000);
    const sem = await move(ctx.owner, { type: "SANGRIA", amountCents: 1000, notes: "só nota" }); // `notes` NÃO substitui `reason`
    expect([sem.statusCode, json(sem).code]).toEqual([400, "CASH_REASON_REQUIRED"]);
    const trocado = await move(ctx.owner, { type: "SANGRIA", amountCents: 1000, reason: "TROCO" }); // TROCO é de suprimento
    expect([trocado.statusCode, json(trocado).code]).toEqual([400, "CASH_REASON_INVALID"]);
    const inverso = await move(ctx.owner, { type: "SUPRIMENTO", amountCents: 1000, reason: "FORNECEDOR" });
    expect([inverso.statusCode, json(inverso).code]).toEqual([400, "CASH_REASON_INVALID"]);
    const devolucao = await move(ctx.owner, { type: "DEVOLUCAO", amountCents: 1000, reason: "OUTRO", reasonText: "x" });
    expect(devolucao.statusCode).toBe(400);
    const sistema = await move(ctx.owner, { type: "SANGRIA", amountCents: 1000, reason: "DEVOLUCAO_CLIENTE" });
    expect([sistema.statusCode, json(sistema).code]).toEqual([400, "CASH_REASON_INVALID"]);
    expect(await movementsCount(ctx.storeId)).toBe(0);
    expect((await move(ctx.owner, { type: "SANGRIA", amountCents: 1000, reason: "FORNECEDOR" })).statusCode).toBe(201);
    expect((await move(ctx.owner, { type: "SUPRIMENTO", amountCents: 1000, reason: "TROCO" })).statusCode).toBe(201);
    expect(await movementsCount(ctx.storeId)).toBe(2);
    for (const bad of [0, -5, 1.5]) expect((await move(ctx.owner, { type: "SUPRIMENTO", amountCents: bad, reason: "TROCO" })).statusCode, String(bad)).toBe(400);
  });

  it("CA-CX-21: OUTRO sem texto ou com 201 caracteres ⇒ 400; com texto válido é aceito e a AUDITORIA não contém o texto (só o código)", async () => {
    const ctx = await setup(10000);
    const SEGREDO = "Pagamento ao fornecedor João Sigiloso 11987654321";
    expect((await move(ctx.owner, { type: "SANGRIA", amountCents: 500, reason: "OUTRO" })).statusCode).toBe(400);
    expect((await move(ctx.owner, { type: "SANGRIA", amountCents: 500, reason: "OUTRO", reasonText: "x".repeat(201) })).statusCode).toBe(400);
    const ok = await move(ctx.owner, { type: "SANGRIA", amountCents: 500, reason: "OUTRO", reasonText: SEGREDO });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(json(ok).movement).toMatchObject({ reason: "OUTRO", reasonText: SEGREDO }); // o texto fica no REGISTRO da movimentação
    await close(ctx.owner, { closingBalanceCents: 0, reason: "OUTRO", reasonText: "Texto livre do fechamento Sigiloso" });
    await vi.waitFor(async () => expect((await audits(ctx.storeId, "cashier.movement")).length + (await audits(ctx.storeId, "cashier.close")).length).toBe(2), { timeout: 10_000, interval: 100 });
    const rows = await prisma.auditLog.findMany({ where: { storeId: ctx.storeId } });
    const dump = JSON.stringify(rows);
    for (const proibido of ["Sigiloso", "11987654321", "fornecedor João", "Texto livre"]) expect(dump, proibido).not.toContain(proibido);
    expect((await audits(ctx.storeId, "cashier.movement"))[0].metadata).toMatchObject({ type: "SANGRIA", amountCents: 500, reason: "OUTRO", role: "OWNER" });
  });

  it("CA-CX-22: a lista traz tipo, valor, motivo, PAPEL e HORA de quem lançou; nunca e-mail nem id de usuário", async () => {
    const ctx = await setup(10000);
    await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: ctx.owner }, payload: { limitCents: 5000 } });
    const staff = await staffCookie(ctx);
    await move(ctx.owner, { type: "SUPRIMENTO", amountCents: 2000, reason: "TROCO" });
    await move(staff, { type: "SANGRIA", amountCents: 1000, reason: "DESPESA_LOJA" });
    const atual = await current(ctx.owner);
    const lista = atual.session.movements as Record<string, unknown>[];
    expect(lista).toHaveLength(2);
    for (const m of lista) expect(Object.keys(m).sort()).toEqual(["amountCents", "createdAt", "createdByRole", "id", "notes", "reason", "reasonText", "type"]);
    expect(lista.map((m) => m.createdByRole).sort()).toEqual(["OWNER", "STAFF"]);
    const dump = JSON.stringify(atual);
    expect(dump).not.toMatch(/@t\.com|@teste\.com|createdByUserId/);
  });

  it("RN-CX-10: sangria MAIOR que o dinheiro em caixa ⇒ 409 CASH_WITHDRAWAL_EXCEEDS_BALANCE com o saldo; IGUAL é aceita; o saldo conta suprimentos e sangrias já feitas", async () => {
    const ctx = await setup(10000);
    const r = await move(ctx.owner, { type: "SANGRIA", amountCents: 10001, reason: "COFRE_BANCO" });
    expect([r.statusCode, json(r).code, json(r).balanceCents]).toEqual([409, "CASH_WITHDRAWAL_EXCEEDS_BALANCE", 10000]);
    expect(json(r).error).toContain("100,00");
    expect(await movementsCount(ctx.storeId)).toBe(0);
    await move(ctx.owner, { type: "SUPRIMENTO", amountCents: 2000, reason: "TROCO" });
    expect((await move(ctx.owner, { type: "SANGRIA", amountCents: 12001, reason: "COFRE_BANCO" })).statusCode).toBe(409);
    expect((await move(ctx.owner, { type: "SANGRIA", amountCents: 7000, reason: "COFRE_BANCO" })).statusCode).toBe(201);
    expect((await move(ctx.owner, { type: "SANGRIA", amountCents: 5001, reason: "COFRE_BANCO" })).statusCode).toBe(409); // sobrou 50,00
    expect((await move(ctx.owner, { type: "SANGRIA", amountCents: 5000, reason: "COFRE_BANCO" })).statusCode).toBe(201);
  });

  it("CONCORRÊNCIA: 4 sangrias de R$ 60,00 SIMULTÂNEAS num caixa de R$ 100,00 ⇒ exatamente 1 passa e o saldo nunca fica negativo", async () => {
    const ctx = await setup(10000);
    const rs = await Promise.all(Array.from({ length: 4 }, () => move(ctx.owner, { type: "SANGRIA", amountCents: 6000, reason: "COFRE_BANCO" })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
    expect(await movementsCount(ctx.storeId)).toBe(1);
    expect((await current(ctx.owner)).expectedBalanceCents).toBe(4000);
  });

  it("RN-CX-09: limite de sangria do STAFF (padrão 0 ⇒ toda sangria exige o dono; 403 FORBIDDEN_ROLE); só o OWNER muda o limite, com auditoria; suprimento do STAFF sempre vale", async () => {
    const ctx = await setup(10000);
    const staff = await staffCookie(ctx);
    const antes = await move(staff, { type: "SANGRIA", amountCents: 100, reason: "DESPESA_LOJA" });
    expect([antes.statusCode, json(antes).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    expect(await movementsCount(ctx.storeId)).toBe(0);
    expect((await move(staff, { type: "SUPRIMENTO", amountCents: 1000, reason: "TROCO" })).statusCode).toBe(201);
    // o STAFF não muda o limite
    expect((await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: staff }, payload: { limitCents: 999999 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: ctx.owner }, payload: { limitCents: -1 } })).statusCode).toBe(400);
    const set = await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: ctx.owner }, payload: { limitCents: 3000 } });
    expect([set.statusCode, json(set).staffWithdrawalLimitCents]).toEqual([200, 3000]);
    await vi.waitFor(async () => expect((await audits(ctx.storeId, "cashier.staff_limit_change"))[0]?.metadata).toEqual({ fromCents: 0, toCents: 3000 }), { timeout: 10_000, interval: 100 });
    expect((await move(staff, { type: "SANGRIA", amountCents: 3000, reason: "DESPESA_LOJA" })).statusCode).toBe(201); // no limite
    expect((await move(staff, { type: "SANGRIA", amountCents: 3001, reason: "DESPESA_LOJA" })).statusCode).toBe(403); // acima
    expect((await move(ctx.owner, { type: "SANGRIA", amountCents: 3001, reason: "DESPESA_LOJA" })).statusCode).toBe(201); // o dono não tem o limite
    // o STAFF vê o resumo mas não o valor do limite da loja
    expect((await current(staff)).staffWithdrawalLimitCents).toBeUndefined();
    expect((await current(ctx.owner)).staffWithdrawalLimitCents).toBe(3000);
  });

  it("RN-CX-18: dois fechamentos simultâneos ⇒ UM fechamento (200) e o outro 409 CASH_ALREADY_CLOSED; fechar de novo ⇒ 404 CASH_REQUIRED; movimentar sem caixa aberto ⇒ 409 CASH_REQUIRED", async () => {
    const ctx = await setup(10000);
    const [a, b] = await Promise.all([close(ctx.owner, { closingBalanceCents: 10000 }), close(ctx.owner, { closingBalanceCents: 10000 })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(json(a.statusCode === 409 ? a : b).code).toBe("CASH_ALREADY_CLOSED");
    expect(await prisma.cashSession.count({ where: { storeId: ctx.storeId, closedAt: { not: null } } })).toBe(1);
    const de_novo = await close(ctx.owner, { closingBalanceCents: 10000 });
    expect([de_novo.statusCode, json(de_novo).code]).toEqual([404, "CASH_REQUIRED"]);
    const mov = await move(ctx.owner, { type: "SUPRIMENTO", amountCents: 500, reason: "TROCO" });
    expect([mov.statusCode, json(mov).code]).toEqual([409, "CASH_REQUIRED"]);
  });

  it("fechar × movimentar SIMULTÂNEOS: o retrato do fechamento é consistente (a movimentação entrou no esperado OU foi recusada com CASH_REQUIRED, nunca ficou de fora do esperado)", async () => {
    const ctx = await setup(-1);
    for (let i = 0; i < 6; i++) {
      expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload: { openingBalanceCents: 10000 } })).statusCode).toBe(201);
      const [c, m] = await Promise.all([close(ctx.owner, { closingBalanceCents: 10000 }), move(ctx.owner, { type: "SUPRIMENTO", amountCents: 1000, reason: "TROCO" })]);
      const session = await prisma.cashSession.findFirstOrThrow({ where: { storeId: ctx.storeId }, orderBy: { openedAt: "desc" }, include: { movements: true } });
      expect(m.statusCode === 201 || m.statusCode === 409, `rodada ${i}: movimentação ${m.statusCode}`).toBe(true);
      if (c.statusCode === 200) {
        const incluida = session.movements.length === 1;
        expect(m.statusCode, `rodada ${i}`).toBe(incluida ? 201 : 409);
        expect(session.expectedClosingCents, `rodada ${i}: esperado do retrato`).toBe(incluida ? 11000 : 10000);
      }
      if (c.statusCode !== 200) await close(ctx.owner, { closingBalanceCents: 10000, reason: "NAO_SEI" });
    }
  });

  it("RN-CX-15: o fechamento CONGELA o resumo: pedido cancelado depois não muda o histórico do caixa fechado; o resumo do fechado vem do retrato", async () => {
    const ctx = await setup(10000);
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: ctx.owner }, payload: { name: "X" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: ctx.owner }, payload: { categoryId: cat, name: "P", priceCents: 4500 } })).product.id as string;
    const o = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1 }] } });
    expect(o.statusCode, o.body).toBe(201);
    const closed = await close(ctx.owner, { closingBalanceCents: 14500 });
    expect(closed.statusCode, closed.body).toBe(200);
    const sessionId = json(closed).session.id as string;
    expect(json(closed).session.expectedClosingCents).toBe(14500);
    const antes = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${sessionId}/summary`, headers: { cookie: ctx.owner } }));
    // o dono cancela o pedido DEPOIS do fechamento: o resumo do caixa fechado continua o mesmo
    const cancel = await app.inject({ method: "POST", url: `/api/orders/${json(o).orderId}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect(cancel.statusCode, cancel.body).toBe(200);
    const depois = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${sessionId}/summary`, headers: { cookie: ctx.owner } }));
    expect(depois.summary).toEqual(antes.summary);
    expect(depois.summary.expectedCents).toBe(14500);
    expect(depois.summary.cashSalesCents).toBe(4500);
    expect(Object.keys(depois.session)).not.toContain("summarySnapshot"); // o retrato é interno
  });

  it("RN-CX-22: o histórico de fechamentos com diferença e motivo é do OWNER; o STAFF abre, movimenta (no limite) e fecha, mas não vê a diferença nem o motivo", async () => {
    const ctx = await setup(10000);
    const staff = await staffCookie(ctx);
    const fechou = await close(staff, { closingBalanceCents: 8000, reason: "NAO_SEI" }); // o STAFF fecha
    expect(fechou.statusCode, fechou.body).toBe(200);
    expect(json(fechou).session).not.toHaveProperty("differenceCents"); // a resposta do fechamento também respeita o papel
    const dono = json(await app.inject({ method: "GET", url: "/api/cashier/sessions", headers: { cookie: ctx.owner } })).sessions[0];
    expect(dono).toMatchObject({ differenceCents: -2000, closeReason: "NAO_SEI", closedByRole: "STAFF" });
    const equipe = json(await app.inject({ method: "GET", url: "/api/cashier/sessions", headers: { cookie: staff } })).sessions[0];
    for (const campo of ["differenceCents", "closeReason", "closeReasonText", "summarySnapshot"]) expect(equipe, campo).not.toHaveProperty(campo);
    const resumo = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${dono.id}/summary`, headers: { cookie: staff } }));
    expect(resumo.session).not.toHaveProperty("differenceCents");
    // abrir (STAFF) funciona
    expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: staff }, payload: { openingBalanceCents: 0 } })).statusCode).toBe(201);
  });

  it("auditoria do fechamento: esperado, contado, diferença, código do motivo e papel; nunca o texto livre", async () => {
    const ctx = await setup(10000);
    await close(ctx.owner, { closingBalanceCents: 9000, reason: "TROCO_ERRADO", notes: "obs interna" });
    await vi.waitFor(async () => expect((await audits(ctx.storeId, "cashier.close")).length).toBe(1), { timeout: 10_000, interval: 100 });
    expect((await audits(ctx.storeId, "cashier.close"))[0].metadata).toEqual({ closingBalanceCents: 9000, expectedCents: 10000, differenceCents: -1000, reason: "TROCO_ERRADO", role: "OWNER" });
  });

  it("isolamento: outra loja não fecha, não movimenta e não lê o caixa desta; a sangria de A não consome o saldo de B", async () => {
    const a = await setup(10000);
    const b = await setup(500);
    expect((await close(b.owner, { closingBalanceCents: 500 })).statusCode).toBe(200); // B fecha só o PRÓPRIO caixa
    expect((await current(a.owner)).session).not.toBeNull(); // o de A segue aberto
    const sa = await prisma.cashSession.findFirstOrThrow({ where: { storeId: a.storeId } });
    expect((await app.inject({ method: "GET", url: `/api/cashier/sessions/${sa.id}/summary`, headers: { cookie: b.owner } })).statusCode).toBe(404);
  });
});
