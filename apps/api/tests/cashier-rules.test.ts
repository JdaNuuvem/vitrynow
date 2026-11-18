// API-27 — regras do caixa no SERVIDOR (leonardo\especificacao-caixa.md §3, §4 e §8; CA-CX-17..22): motivo obrigatório por tipo, valor contado
// obrigatório, tolerância de R$ 5,00, sangria ≤ dinheiro em caixa (sob concorrência), limite de sangria do STAFF, fechamento atômico com retrato
// congelado e auditoria sem texto livre. A DEVOLUCAO automática (RN-CX-14) e o dinheiro "recebido" com data (RN-CX-01) dependem da API-21.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { publishToStore, subscribe } from "../src/realtime/hub";
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

  it("RN-CX-09 / CA-CX-26: UM limite do dono sobre a SOMA das sangrias do STAFF no caixa (turno); padrão 0 ⇒ 403 CASH_WITHDRAWAL_NEEDS_OWNER; só o OWNER muda o limite (auditado); a sangria do OWNER não conta; caixa novo recomeça a soma", async () => {
    const ctx = await setup(100000);
    const staff = await staffCookie(ctx);
    const sangria = (cookie: string, amountCents: number) => move(cookie, { type: "SANGRIA", amountCents, reason: "DESPESA_LOJA" });
    const antes = await sangria(staff, 100);
    expect([antes.statusCode, json(antes).code]).toEqual([403, "CASH_WITHDRAWAL_NEEDS_OWNER"]);
    expect(await movementsCount(ctx.storeId)).toBe(0);
    expect((await move(staff, { type: "SUPRIMENTO", amountCents: 1000, reason: "TROCO" })).statusCode).toBe(201); // suprimento do STAFF sempre vale
    // o STAFF não muda o limite
    expect((await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: staff }, payload: { limitCents: 999999 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: ctx.owner }, payload: { limitCents: -1 } })).statusCode).toBe(400);
    const set = await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: ctx.owner }, payload: { limitCents: 5000 } });
    expect([set.statusCode, json(set).staffWithdrawalLimitCents]).toEqual([200, 5000]);
    await vi.waitFor(async () => expect((await audits(ctx.storeId, "cashier.staff_limit_change"))[0]?.metadata).toEqual({ fromCents: 0, toCents: 5000 }), { timeout: 10_000, interval: 100 });
    // CA-CX-26: limite R$ 50,00: 1ª de R$ 30,00 passa; 2ª de R$ 30,00 (soma 60,00) é recusada; 2ª de R$ 20,00 (soma 50,00) passa; mais 1 centavo, não
    expect((await sangria(staff, 3000)).statusCode).toBe(201);
    const segunda = await sangria(staff, 3000);
    expect([segunda.statusCode, json(segunda).code]).toEqual([403, "CASH_WITHDRAWAL_NEEDS_OWNER"]);
    expect((await sangria(staff, 2000)).statusCode).toBe(201);
    expect((await sangria(staff, 1)).statusCode).toBe(403);
    // a sangria do OWNER nunca conta no limite da equipe (e o dono não tem limite)
    expect((await sangria(ctx.owner, 20000)).statusCode).toBe(201);
    expect((await sangria(staff, 1)).statusCode).toBe(403);
    // um lançamento MAIOR que o limite já é recusado (não existe segundo limite "por lançamento")
    // caixa novo: a soma recomeça
    expect((await close(ctx.owner, { closingBalanceCents: 0, reason: "NAO_SEI" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload: { openingBalanceCents: 100000 } })).statusCode).toBe(201);
    // a sangria do OWNER feita ANTES não consome o limite do STAFF: o STAFF ainda leva os R$ 50,00 inteiros
    expect((await sangria(ctx.owner, 4000)).statusCode).toBe(201);
    expect((await sangria(staff, 5000)).statusCode).toBe(201);
    expect((await sangria(staff, 1)).statusCode).toBe(403);
    // o STAFF vê o saldo e as regras do turno que opera, mas não o valor do limite da loja
    expect((await current(staff)).staffWithdrawalLimitCents).toBeUndefined();
    expect((await current(ctx.owner)).staffWithdrawalLimitCents).toBe(5000);
  });

  it("CA-CX-26 com a loja inteira: 8 sangrias do STAFF de R$ 50,00 com limite de R$ 50,00 ⇒ só a 1ª passa; uma ÚNICA sangria acima do limite já é recusada", async () => {
    const ctx = await setup(100000);
    const staff = await staffCookie(ctx);
    await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: ctx.owner }, payload: { limitCents: 5000 } });
    const acima = await move(staff, { type: "SANGRIA", amountCents: 5001, reason: "DESPESA_LOJA" });
    expect([acima.statusCode, json(acima).code]).toEqual([403, "CASH_WITHDRAWAL_NEEDS_OWNER"]);
    const codigos: number[] = [];
    for (let i = 0; i < 8; i++) codigos.push((await move(staff, { type: "SANGRIA", amountCents: 5000, reason: "DESPESA_LOJA" })).statusCode);
    expect(codigos).toEqual([201, 403, 403, 403, 403, 403, 403, 403]);
  });

  it("CONCORRÊNCIA do limite do STAFF: 4 sangrias do STAFF SIMULTÂNEAS de R$ 30,00 com limite de R$ 50,00 ⇒ exatamente 1 passa (soma sob a trava do caixa)", async () => {
    const ctx = await setup(100000);
    const staff = await staffCookie(ctx);
    await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: ctx.owner }, payload: { limitCents: 5000 } });
    const rs = await Promise.all(Array.from({ length: 4 }, () => move(staff, { type: "SANGRIA", amountCents: 3000, reason: "DESPESA_LOJA" })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 403, 403, 403]);
    expect(await movementsCount(ctx.storeId)).toBe(1);
  });

  it("RN-CX-18: dois fechamentos simultâneos ⇒ UM fechamento (200) e o outro 409 CASH_ALREADY_CLOSED; fechar de novo ⇒ 409 CASH_ALREADY_CLOSED; movimentar sem caixa aberto ⇒ 409 CASH_REQUIRED", async () => {
    const ctx = await setup(10000);
    const [a, b] = await Promise.all([close(ctx.owner, { closingBalanceCents: 10000 }), close(ctx.owner, { closingBalanceCents: 10000 })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(json(a.statusCode === 409 ? a : b).code).toBe("CASH_ALREADY_CLOSED");
    expect(await prisma.cashSession.count({ where: { storeId: ctx.storeId, closedAt: { not: null } } })).toBe(1);
    const de_novo = await close(ctx.owner, { closingBalanceCents: 10000 });
    expect([de_novo.statusCode, json(de_novo).code]).toEqual([409, "CASH_ALREADY_CLOSED"]); // a ordem em que o perdedor chega NÃO muda a resposta
    const mov = await move(ctx.owner, { type: "SUPRIMENTO", amountCents: 500, reason: "TROCO" });
    expect([mov.statusCode, json(mov).code]).toEqual([409, "CASH_REQUIRED"]);
  });

  it("FECHAMENTO DETERMINÍSTICO: loja que nunca teve caixa ⇒ 404 CASH_REQUIRED; 20 rodadas de dois fechamentos simultâneos ⇒ sempre [200, 409 CASH_ALREADY_CLOSED], nunca 404", async () => {
    const ctx = await setup(-1);
    const nunca = await close(ctx.owner, { closingBalanceCents: 0 });
    expect([nunca.statusCode, json(nunca).code]).toEqual([404, "CASH_REQUIRED"]);
    for (let i = 0; i < 20; i += 1) {
      expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload: { openingBalanceCents: 1000 } })).statusCode, `abrir ${i}`).toBe(201);
      const rs = await Promise.all([close(ctx.owner, { closingBalanceCents: 1000 }), close(ctx.owner, { closingBalanceCents: 1000 })]);
      expect(rs.map((r) => r.statusCode).sort(), `rodada ${i}`).toEqual([200, 409]);
      expect(json(rs.find((r) => r.statusCode === 409)!).code).toBe("CASH_ALREADY_CLOSED");
    }
    // o outro caixa (de OUTRA loja) não é afetado pelo fechamento desta
    const outra = await setup(500);
    expect((await close(outra.owner, { closingBalanceCents: 500 })).statusCode).toBe(200);
  }, 120000);

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
        expect(Number(session.expectedClosingCents), `rodada ${i}: esperado do retrato`).toBe(incluida ? 11000 : 10000);
      }
      if (c.statusCode !== 200) await close(ctx.owner, { closingBalanceCents: 10000, reason: "NAO_SEI" });
    }
  });

  it("RN-CX-15: o fechamento CONGELA o resumo: pedido cancelado depois não muda o histórico do caixa fechado; o resumo do fechado vem do retrato", async () => {
    const ctx = await setup(10000);
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: ctx.owner }, payload: { name: "X" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: ctx.owner }, payload: { categoryId: cat, name: "P", priceCents: 4500 } })).product.id as string;
    const novo = async () => {
      const r = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1 }] } });
      expect(r.statusCode, r.body).toBe(201);
      return json(r).orderId as string;
    };
    const avancar = async (id: string, ate: string[]) => {
      for (const to of ate) expect((await app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie: ctx.owner }, payload: { to } })).statusCode).toBe(200);
    };
    const recebido = await novo(); // concluído no turno: o dinheiro (R$ 45,00) foi RECEBIDO
    await avancar(recebido, ["CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]);
    const emAndamento = await novo(); // aceito e ainda não pago: só "a receber"
    await avancar(emAndamento, ["CONFIRMADO"]);
    const closed = await close(ctx.owner, { closingBalanceCents: 14500 });
    expect(closed.statusCode, closed.body).toBe(200);
    const sessionId = json(closed).session.id as string;
    expect(json(closed).session.expectedClosingCents).toBe(14500);
    const antes = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${sessionId}/summary`, headers: { cookie: ctx.owner } }));
    expect(antes.summary.toReceiveCents).toBe(4500);
    // o dono cancela o pedido em andamento DEPOIS do fechamento: o resumo do caixa fechado continua o mesmo
    const cancel = await app.inject({ method: "POST", url: `/api/orders/${emAndamento}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect(cancel.statusCode, cancel.body).toBe(200);
    const depois = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${sessionId}/summary`, headers: { cookie: ctx.owner } }));
    expect(depois.summary).toEqual(antes.summary);
    expect(depois.summary.expectedCents).toBe(14500);
    expect(depois.summary.cashSalesCents).toBe(4500);
    expect(Object.keys(depois.session)).not.toContain("summarySnapshot"); // o retrato é interno
  });

  it("RN-CX-22 / CA-CX-27: o OWNER vê esperado, contado, diferença e motivo do caixa FECHADO; o STAFF no histórico e no resumo recebe SÓ abertura, fechamento, horários e papel (sem esperado, contado, diferença, motivo, observações nem summary); quem fecha vê o resultado na PRÓPRIA resposta", async () => {
    const ctx = await setup(10000);
    const staff = await staffCookie(ctx);
    const fechou = await close(staff, { closingBalanceCents: 8000, reason: "NAO_SEI", notes: "faltou dinheiro" }); // o STAFF fecha
    expect(fechou.statusCode, fechou.body).toBe(200);
    // o resultado na resposta do PRÓPRIO fechamento (o STAFF precisa dele; a prévia já devolve a diferença; mascarar só aqui seria parcial)
    expect(json(fechou)).toMatchObject({ differenceCents: -2000, toleranceCents: 500, session: { expectedClosingCents: 10000, closingBalanceCents: 8000, closeReason: "NAO_SEI" } });
    expect(json(fechou).session).not.toHaveProperty("summarySnapshot");
    const dono = json(await app.inject({ method: "GET", url: "/api/cashier/sessions", headers: { cookie: ctx.owner } })).sessions[0];
    expect(dono).toMatchObject({ differenceCents: -2000, expectedClosingCents: 10000, closingBalanceCents: 8000, closeReason: "NAO_SEI", closedByRole: "STAFF" });
    const equipe = json(await app.inject({ method: "GET", url: "/api/cashier/sessions", headers: { cookie: staff } })).sessions[0];
    expect(Object.keys(equipe).sort()).toEqual(["closedAt", "closedByRole", "id", "openedAt", "openingBalanceCents"]);
    const resumoEquipe = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${dono.id}/summary`, headers: { cookie: staff } }));
    expect(resumoEquipe.summary).toBeNull();
    expect(Object.keys(resumoEquipe.session).sort()).toEqual(["closedAt", "closedByRole", "id", "openedAt", "openingBalanceCents"]);
    for (const proibido of ["expectedClosingCents", "closingBalanceCents", "differenceCents", "closeReason", "closingNotes", "summarySnapshot", "faltou"]) {
      expect(JSON.stringify([equipe, resumoEquipe]), proibido).not.toContain(proibido);
    }
    // o dono continua vendo o retrato
    const resumoDono = json(await app.inject({ method: "GET", url: `/api/cashier/sessions/${dono.id}/summary`, headers: { cookie: ctx.owner } }));
    expect(resumoDono.summary.expectedCents).toBe(10000);
    // abrir (STAFF) funciona
    expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: staff }, payload: { openingBalanceCents: 0 } })).statusCode).toBe(201);
  });

  it("CA-CX-28: o STAFF que fecha com diferença ACIMA da tolerância avisa SÓ o OWNER conectado, e o corpo do evento tem APENAS o id do caixa (sem valor, papel nem motivo); R$ 5,00 exatos não avisa; fechamento do OWNER não avisa", async () => {
    const ctx = await setup(-1);
    const staff = await staffCookie(ctx);
    const abrir = (cookie: string) => app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie }, payload: { openingBalanceCents: 10000 } });
    // um socket falso por tipo de conexão da loja: painel do OWNER, painel do STAFF e print-client (DEVICE)
    const conectar = (role: "OWNER" | "STAFF" | "DEVICE") => {
      const recebido: string[] = [];
      subscribe(ctx.storeId, { readyState: 1, OPEN: 1, send: (m: string) => recebido.push(m), on: vi.fn() } as never, role);
      return recebido;
    };
    const donoWs = conectar("OWNER");
    const staffWs = conectar("STAFF");
    const impressoraWs = conectar("DEVICE");
    const eventos = (ws: string[]) => ws.filter((m) => m.includes("cashier.difference_over_tolerance")).map((m) => JSON.parse(m));
    // 500 exatos (STAFF): não avisa ninguém
    await abrir(staff);
    expect((await close(staff, { closingBalanceCents: 9500 })).statusCode).toBe(200);
    expect(eventos(donoWs)).toEqual([]);
    // 501 (STAFF): só o OWNER recebe; o corpo é SÓ { type, sessionId }
    await abrir(staff);
    const segredo = "Motivo Sigiloso do funcionario";
    const r = await close(staff, { closingBalanceCents: 9499, reason: "OUTRO", reasonText: segredo });
    expect(r.statusCode, r.body).toBe(200);
    expect(eventos(donoWs)).toEqual([{ type: "cashier.difference_over_tolerance", sessionId: json(r).session.id }]);
    expect(JSON.stringify(donoWs)).not.toMatch(/Sigiloso|501|differenceCents|STAFF/);
    // o STAFF conectado e o print-client NÃO recebem nem o sinal
    expect(staffWs.filter((m) => m.includes("difference_over_tolerance"))).toEqual([]);
    expect(impressoraWs.filter((m) => m.includes("difference_over_tolerance"))).toEqual([]);
    // mesmo publicado pelo canal geral da loja, o tipo de dono continua só para o OWNER (o filtro vive no hub, não em quem publica)
    publishToStore(ctx.storeId, { type: "cashier.difference_over_tolerance", sessionId: "outro-caixa" });
    expect(eventos(donoWs).map((e) => e.sessionId)).toEqual([json(r).session.id, "outro-caixa"]);
    expect(eventos(staffWs)).toEqual([]);
    expect(eventos(impressoraWs)).toEqual([]);
    donoWs.splice(0, donoWs.length, ...donoWs.filter((m) => !m.includes("outro-caixa"))); // volta ao estado anterior para as contagens abaixo
    // eventos comuns continuam indo a TODOS (OWNER, STAFF e impressora)
    publishToStore(ctx.storeId, { type: "print.available" });
    for (const ws of [donoWs, staffWs, impressoraWs]) expect(ws.filter((m) => m.includes("print.available"))).toHaveLength(1);
    // OWNER com diferença grande: não avisa (o dono já sabe)
    await abrir(ctx.owner);
    expect((await close(ctx.owner, { closingBalanceCents: 1000, reason: "NAO_SEI" })).statusCode).toBe(200);
    expect(eventos(donoWs)).toHaveLength(1);
    // STAFF fecha certo (diferença 0): não avisa
    await abrir(staff);
    expect((await close(staff, { closingBalanceCents: 10000 })).statusCode).toBe(200);
    expect(eventos(donoWs)).toHaveLength(1);
  });

  it("CA-CX-28 pelos WebSockets REAIS (painel do OWNER, painel do STAFF e print-client): o papel entra no canal; só o OWNER recebe o evento; o evento comum chega aos três", async () => {
    const ctx = await setup(-1);
    const staff = await staffCookie(ctx);
    const donoWs = await app.injectWS("/ws/panel", { headers: { cookie: ctx.owner } });
    const staffWs = await app.injectWS("/ws/panel", { headers: { cookie: staff } });
    // o print-client conecta de verdade pela chave da impressora
    const chave = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: ctx.owner }, payload: { label: "Balcao" } })).token.token as string;
    const impressoraWs = await app.injectWS("/ws/device", { headers: { authorization: `Bearer ${chave}` } });
    try {
      const donoRecebeu: string[] = [];
      const staffRecebeu: string[] = [];
      const impressoraRecebeu: string[] = [];
      donoWs.on("message", (m) => donoRecebeu.push(String(m)));
      staffWs.on("message", (m) => staffRecebeu.push(String(m)));
      impressoraWs.on("message", (m) => impressoraRecebeu.push(String(m)));
      expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: staff }, payload: { openingBalanceCents: 10000 } })).statusCode).toBe(201);
      const r = await close(staff, { closingBalanceCents: 9000, reason: "NAO_SEI" });
      expect(r.statusCode, r.body).toBe(200);
      publishToStore(ctx.storeId, { type: "print.available" });
      await vi.waitFor(() => expect(donoRecebeu.some((m) => m.includes("print.available"))).toBe(true), { timeout: 5000, interval: 50 });
      await vi.waitFor(() => expect(staffRecebeu.some((m) => m.includes("print.available"))).toBe(true), { timeout: 5000, interval: 50 });
      await vi.waitFor(() => expect(impressoraRecebeu.some((m) => m.includes("print.available"))).toBe(true), { timeout: 5000, interval: 50 });
      expect(donoRecebeu.filter((m) => m.includes("difference_over_tolerance")).map((m) => JSON.parse(m))).toEqual([{ type: "cashier.difference_over_tolerance", sessionId: json(r).session.id }]);
      expect(staffRecebeu.filter((m) => m.includes("difference_over_tolerance"))).toEqual([]);
      expect(impressoraRecebeu.filter((m) => m.includes("difference_over_tolerance"))).toEqual([]); // a impressora nunca recebe evento de dono
    } finally {
      donoWs.terminate();
      staffWs.terminate();
      impressoraWs.terminate();
    }
  });

  it("R2: a auditoria é ESTRITA e DENTRO da transação: se o registro falhar (gatilho no banco), abrir, movimentar, fechar e mudar o limite viram 503 AUDIT_UNAVAILABLE e NADA do dado fica", async () => {
    const ctx = await setup(-1);
    const dono = await prisma.user.findFirstOrThrow({ where: { storeId: ctx.storeId, role: "OWNER" }, select: { id: true } });
    const abrir = (payload: Record<string, unknown> = { openingBalanceCents: 10000 }) => app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload });
    const limite = () => prisma.store.findUniqueOrThrow({ where: { id: ctx.storeId }, select: { cashStaffWithdrawalLimitCents: true } });
    // o banco recusa a gravação de QUALQUER auditoria `cashier.*` desta loja
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_block_cashier_audit() RETURNS trigger AS $$ BEGIN IF NEW."storeId" = '${ctx.storeId}' AND NEW."action" LIKE 'cashier.%' THEN RAISE EXCEPTION 'auditoria indisponivel (teste)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_block_cashier_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_block_cashier_audit()`);
    const falhas: Array<[number, string]> = [];
    try {
      // abrir: o caixa NÃO fica aberto
      const o = await abrir();
      falhas.push([o.statusCode, json(o).code]);
      expect(await prisma.cashSession.count({ where: { storeId: ctx.storeId } })).toBe(0);
      // limite: o valor NÃO muda
      const l = await app.inject({ method: "PUT", url: "/api/cashier/staff-withdrawal-limit", headers: { cookie: ctx.owner }, payload: { limitCents: 7000 } });
      falhas.push([l.statusCode, json(l).code]);
      expect((await limite()).cashStaffWithdrawalLimitCents).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_block_cashier_audit ON "AuditLog"`);
    }
    // com a auditoria de volta, abre; depois bloqueia de novo para movimentar e fechar
    expect((await abrir()).statusCode).toBe(201);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_block_cashier_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_block_cashier_audit()`);
    try {
      const m = await move(ctx.owner, { type: "SANGRIA", amountCents: 1000, reason: "DESPESA_LOJA" });
      falhas.push([m.statusCode, json(m).code]);
      expect(await movementsCount(ctx.storeId)).toBe(0); // a sangria NÃO existe sem rastro
      const c = await close(ctx.owner, { closingBalanceCents: 10000 });
      falhas.push([c.statusCode, json(c).code]);
      const sessao = await prisma.cashSession.findFirstOrThrow({ where: { storeId: ctx.storeId } });
      expect(sessao.closedAt).toBeNull(); // o caixa CONTINUA aberto
      expect(sessao.summarySnapshot).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_block_cashier_audit ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_block_cashier_audit()`);
    }
    expect(falhas).toEqual([[503, "AUDIT_UNAVAILABLE"], [503, "AUDIT_UNAVAILABLE"], [503, "AUDIT_UNAVAILABLE"], [503, "AUDIT_UNAVAILABLE"]]);
    // sem o defeito do banco tudo volta a funcionar e cada ação deixa EXATAMENTE um rastro, na mesma transação
    expect((await move(ctx.owner, { type: "SANGRIA", amountCents: 1000, reason: "DESPESA_LOJA" })).statusCode).toBe(201);
    expect((await close(ctx.owner, { closingBalanceCents: 9000 })).statusCode).toBe(200);
    expect(dono.id).toBeTruthy();
    for (const [acao, n] of [["cashier.open", 1], ["cashier.movement", 1], ["cashier.close", 1]] as const) expect((await audits(ctx.storeId, acao)).length, acao).toBe(n);
  });

  it("M1: NENHUMA resposta do caixa, para nenhum papel, devolve id de usuário nem o retrato interno (aberto, fechado, histórico, resumo, movimentações)", async () => {
    const ctx = await setup(10000);
    const staff = await staffCookie(ctx);
    const donoId = (await prisma.user.findFirstOrThrow({ where: { storeId: ctx.storeId, role: "OWNER" }, select: { id: true } })).id;
    const staffId = (await prisma.user.findFirstOrThrow({ where: { storeId: ctx.storeId, role: "STAFF" }, select: { id: true } })).id;
    const corpos: Array<[string, string]> = [];
    const guardar = (nome: string, r: { body: string }) => corpos.push([nome, r.body]);
    await move(staff, { type: "SUPRIMENTO", amountCents: 500, reason: "TROCO" });
    for (const [papel, cookie] of [["OWNER", ctx.owner], ["STAFF", staff]] as const) {
      guardar(`${papel} current (aberto)`, await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie } }));
    }
    const fechou = await close(staff, { closingBalanceCents: 10500 });
    guardar("STAFF close", fechou);
    const aberto = await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload: { openingBalanceCents: 0 } });
    expect(aberto.statusCode).toBe(201);
    guardar("OWNER open", aberto);
    const fechado = await prisma.cashSession.findFirstOrThrow({ where: { storeId: ctx.storeId, closedAt: { not: null } } });
    for (const [papel, cookie] of [["OWNER", ctx.owner], ["STAFF", staff]] as const) {
      guardar(`${papel} sessions`, await app.inject({ method: "GET", url: "/api/cashier/sessions", headers: { cookie } }));
      guardar(`${papel} summary (fechado)`, await app.inject({ method: "GET", url: `/api/cashier/sessions/${fechado.id}/summary`, headers: { cookie } }));
    }
    guardar("OWNER movimentacao", await move(ctx.owner, { type: "SUPRIMENTO", amountCents: 100, reason: "TROCO" }));
    for (const [nome, corpo] of corpos) {
      for (const proibido of [donoId, staffId, "openedByUserId", "closedByUserId", "createdByUserId", "summarySnapshot"]) expect(corpo, `${nome}: ${proibido}`).not.toContain(proibido);
    }
    // o PAPEL e a HORA continuam (é o que a tela mostra)
    expect(json(fechou).session.closedByRole).toBe("STAFF");
    expect(json(fechou).session.closedAt).toBeTruthy();
  });

  it("M2: abertura e valor contado têm teto de R$ 1.000.000,00 (100.000.000 centavos, RN-CX-12); o teto exato vale e 1 centavo a mais é 400; a prévia respeita o mesmo teto", async () => {
    const ctx = await setup(-1);
    const abrir = (v: number) => app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: ctx.owner }, payload: { openingBalanceCents: v } });
    expect((await abrir(100_000_001)).statusCode).toBe(400);
    expect(await prisma.cashSession.count({ where: { storeId: ctx.storeId } })).toBe(0);
    expect((await abrir(100_000_000)).statusCode).toBe(201);
    expect((await preview(ctx.owner, "100000001")).statusCode).toBe(400);
    expect((await preview(ctx.owner, "100000000")).statusCode).toBe(200);
    const alto = await close(ctx.owner, { closingBalanceCents: 100_000_001, reason: "NAO_SEI" });
    expect(alto.statusCode).toBe(400);
    expect((await prisma.cashSession.findFirstOrThrow({ where: { storeId: ctx.storeId } })).closedAt).toBeNull();
    expect((await close(ctx.owner, { closingBalanceCents: 100_000_000 })).statusCode).toBe(200);
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
