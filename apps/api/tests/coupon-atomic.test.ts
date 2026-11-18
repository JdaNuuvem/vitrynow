// FUNC-01 / FUNC-02 — cupom: uso reservado DENTRO da transação do pedido, cadastro com limites e pedido de total zero sem cobrança
// (leonardo\regras-cupom-e-total-zero.md, CA-CP-01..11).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
import { storeToday } from "../src/lib/storeDay";

describe("FUNC-01/02 — cupom e total zero", () => {
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

  async function setup(priceCents = 4000, extraStore: Record<string, unknown> = {}) {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    if (Object.keys(extraStore).length) await prisma.store.update({ where: { id: storeId }, data: extraStore });
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie!  }, payload: { categoryId: cat, name: "P", priceCents } })).product.id as string;
    return { owner: cookie!, storeId: storeId as string, slug: slug as string, productId };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const coupon = (ctx: Ctx, payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/coupons", headers: { cookie: ctx.owner }, payload });
  const order = (ctx: Ctx, payload: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], ...payload } });
  const usedCount = async (code: string, storeId: string) => (await prisma.coupon.findUniqueOrThrow({ where: { storeId_code: { storeId, code } } })).usedCount;

  // ───────────── FUNC-01 ─────────────
  it("CA-CP-01: cupom maxUses=1 e 6 pedidos PARALELOS ⇒ exatamente 1×201, 5×400 COUPON_EXHAUSTED, usedCount=1, sem buraco na numeração", async () => {
    const ctx = await setup(1000);
    expect((await coupon(ctx, { code: "UNICO", discountType: "FIXED", discountValue: 100, maxUses: 1 })).statusCode).toBe(201);
    const results = await Promise.all(Array.from({ length: 6 }, () => order(ctx, { couponCode: "unico" })));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 400, 400, 400, 400, 400]);
    for (const r of results.filter((x) => x.statusCode === 400)) expect(json(r)).toMatchObject({ code: "COUPON_EXHAUSTED", error: "Esse cupom acabou." });
    expect(await usedCount("UNICO", ctx.storeId)).toBe(1);
    // os 5 recusados não gastaram número: o próximo pedido (sem cupom) é o #2
    const next = await order(ctx);
    expect(json(next).code).toBe("0002");
    expect(await prisma.order.count({ where: { storeId: ctx.storeId } })).toBe(2);
  });

  it("maxUses=3 com 10 paralelos ⇒ exatamente 3 pedidos e usedCount=3 (nunca passa do limite)", async () => {
    const ctx = await setup(1000);
    await coupon(ctx, { code: "TRES", discountType: "PERCENT", discountValue: 10, maxUses: 3 });
    const results = await Promise.all(Array.from({ length: 10 }, () => order(ctx, { couponCode: "TRES" })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(3);
    expect(results.filter((r) => r.statusCode === 400)).toHaveLength(7);
    expect(await usedCount("TRES", ctx.storeId)).toBe(3);
    expect(await prisma.order.count({ where: { storeId: ctx.storeId, couponId: { not: null } } })).toBe(3);
  });

  it("cupom sem limite: usos simultâneos todos passam e cada um conta (usedCount = nº de pedidos)", async () => {
    const ctx = await setup(1000);
    await coupon(ctx, { code: "LIVRE", discountType: "FIXED", discountValue: 50 });
    const results = await Promise.all(Array.from({ length: 5 }, () => order(ctx, { couponCode: "LIVRE" })));
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(await usedCount("LIVRE", ctx.storeId)).toBe(5);
  });

  it("CA-CP-02: erro no meio da criação do pedido ⇒ nem o pedido nem o uso do cupom ficam gravados (nunca desconto sem contar)", async () => {
    const ctx = await setup(1000);
    await coupon(ctx, { code: "MEIO", discountType: "FIXED", discountValue: 100, maxUses: 5 });
    // gatilho no banco: recusa o INSERT do histórico de status (acontece DEPOIS da reserva do cupom, dentro da mesma transação)
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION recusa_historico() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha injetada'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER recusa_historico BEFORE INSERT ON "OrderStatusHistory" FOR EACH ROW EXECUTE FUNCTION recusa_historico()`);
    try {
      const r = await order(ctx, { couponCode: "MEIO" });
      expect(r.statusCode).toBeGreaterThanOrEqual(500);
      expect(await prisma.order.count({ where: { storeId: ctx.storeId } })).toBe(0);
      expect(await usedCount("MEIO", ctx.storeId)).toBe(0); // o uso voltou junto com o pedido
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER recusa_historico ON "OrderStatusHistory"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION recusa_historico()`);
    }
    expect((await order(ctx, { couponCode: "MEIO" })).statusCode).toBe(201);
    expect(await usedCount("MEIO", ctx.storeId)).toBe(1);
  });

  it("cupom desativado ENTRE a leitura e a reserva não passa: a reserva confere active no próprio UPDATE (corrida real no banco)", async () => {
    const ctx = await setup(1000);
    await coupon(ctx, { code: "OFF", discountType: "FIXED", discountValue: 100 });
    const couponId = (await prisma.coupon.findFirstOrThrow({ where: { storeId: ctx.storeId } })).id;
    let pedido: Promise<{ statusCode: number; body: string }> | undefined;
    // Seguro a linha do cupom: o pedido lê o cupom (ainda ativo), entra na transação e BLOQUEIA no UPDATE da reserva.
    // Enquanto ele espera, o dono desativa o cupom; ao liberar, o banco reavalia o WHERE e a reserva não acha linha.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${couponId} FOR UPDATE`;
      pedido = order(ctx, { couponCode: "OFF" });
      await vi.waitFor(
        async () => {
          const waiting = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%"usedCount" + 1%'`;
          expect(Number(waiting[0].n)).toBeGreaterThan(0);
        },
        { timeout: 10_000, interval: 50 },
      );
      await tx.coupon.update({ where: { id: couponId }, data: { active: false } });
    });
    const r = await pedido!;
    expect(r.statusCode, r.body).toBe(400);
    expect(json(r).code).toBe("COUPON_EXHAUSTED");
    expect(await usedCount("OFF", ctx.storeId)).toBe(0);
    expect(await prisma.order.count({ where: { storeId: ctx.storeId } })).toBe(0);
  });

  it("a devolução ao cancelar continua UMA vez só (usedCount volta de 1 para 0 e não passa disso)", async () => {
    const ctx = await setup(1000);
    await coupon(ctx, { code: "VOLTA", discountType: "FIXED", discountValue: 100, maxUses: 1 });
    const id = json(await order(ctx, { couponCode: "VOLTA" })).orderId as string;
    const cancel = () => app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect((await cancel()).statusCode).toBe(200);
    await cancel(); // repetido: recusa (já cancelado) e não devolve de novo
    expect(await usedCount("VOLTA", ctx.storeId)).toBe(0);
    expect((await order(ctx, { couponCode: "VOLTA" })).statusCode).toBe(201); // a vaga voltou
  });

  // ───────────── FUNC-02: cadastro ─────────────
  it("CA-CP-03: PERCENT 150 ⇒ 400 COUPON_VALUE_INVALID; 100 sem maxUses ⇒ 400 COUPON_NEEDS_LIMIT; 100 com maxUses=10 ⇒ 201; 0/negativo ⇒ 400", async () => {
    const ctx = await setup();
    const r150 = await coupon(ctx, { code: "CENTO50", discountType: "PERCENT", discountValue: 150 });
    expect([r150.statusCode, json(r150).code]).toEqual([400, "COUPON_VALUE_INVALID"]);
    const r101 = await coupon(ctx, { code: "CEMUM", discountType: "PERCENT", discountValue: 101, maxUses: 5 });
    expect([r101.statusCode, json(r101).code]).toEqual([400, "COUPON_VALUE_INVALID"]);
    const semLimite = await coupon(ctx, { code: "GRATIS", discountType: "PERCENT", discountValue: 100 });
    expect([semLimite.statusCode, json(semLimite).code]).toEqual([400, "COUPON_NEEDS_LIMIT"]);
    expect((await coupon(ctx, { code: "GRATIS", discountType: "PERCENT", discountValue: 100, maxUses: 10 })).statusCode).toBe(201);
    expect((await coupon(ctx, { code: "NOVENTA", discountType: "PERCENT", discountValue: 99 })).statusCode).toBe(201); // 99% sem limite pode
    for (const v of [0, -5]) expect((await coupon(ctx, { code: `NEG${Math.abs(v)}X`, discountType: "PERCENT", discountValue: v })).statusCode, String(v)).toBe(400);
    expect(await prisma.coupon.count({ where: { storeId: ctx.storeId } })).toBe(2);
  });

  it("editar não burla a regra: subir para 100% sem limite, tirar o limite de um 100% ou passar de 100 ⇒ 400, e nada muda", async () => {
    const ctx = await setup();
    const id = json(await coupon(ctx, { code: "EDIT", discountType: "PERCENT", discountValue: 50 })).coupon.id as string;
    const edit = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: `/api/coupons/${id}`, headers: { cookie: ctx.owner }, payload });
    const to100 = await edit({ discountValue: 100 });
    expect([to100.statusCode, json(to100).code]).toEqual([400, "COUPON_NEEDS_LIMIT"]);
    const to150 = await edit({ discountValue: 150 });
    expect([to150.statusCode, json(to150).code]).toEqual([400, "COUPON_VALUE_INVALID"]);
    expect((await edit({ discountValue: 100, maxUses: 4 })).statusCode).toBe(200);
    expect((await edit({ maxUses: 0 })).statusCode).toBe(400); // limite inválido
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id } })).discountValue).toBe(100);
  });

  it("CA-CP-04: FIXED ≤ 0 ⇒ 400; código com espaço, acento ou 2 caracteres ⇒ 400; repetido na loja ⇒ 409 COUPON_CODE_TAKEN; igual em outra loja ⇒ 201", async () => {
    const a = await setup();
    const b = await setup();
    for (const v of [0, -100]) expect((await coupon(a, { code: "FIXO", discountType: "FIXED", discountValue: v })).statusCode, String(v)).toBe(400);
    for (const code of ["AB", "COM ESPACO", "AÇAÍ10", "a".repeat(21), ""]) {
      expect((await coupon(a, { code, discountType: "FIXED", discountValue: 100 })).statusCode, code).toBe(400);
    }
    const ok = await coupon(a, { code: " promo-10_x ", discountType: "FIXED", discountValue: 100 });
    expect(ok.statusCode).toBe(201);
    expect(json(ok).coupon.code).toBe("PROMO-10_X"); // maiúsculas, sem espaços nas pontas
    const dup = await coupon(a, { code: "promo-10_x", discountType: "FIXED", discountValue: 100 });
    expect([dup.statusCode, json(dup).code]).toEqual([409, "COUPON_CODE_TAKEN"]);
    expect((await coupon(b, { code: "PROMO-10_X", discountType: "FIXED", discountValue: 100 })).statusCode).toBe(201);
  });

  it("cadastro simultâneo do MESMO código ⇒ 1×201 e o resto 409 COUPON_CODE_TAKEN (a unicidade do banco decide, nunca 500)", async () => {
    const ctx = await setup();
    const results = await Promise.all(Array.from({ length: 4 }, () => coupon(ctx, { code: "CORRIDA", discountType: "FIXED", discountValue: 100 })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
  });

  it("CA-CP-15: \"Vale até\" é o FIM do dia da loja: hoje é aceito (vale até 23:59), ontem ⇒ 400 COUPON_EXPIRY_INVALID, instante ISO passado ⇒ 400", async () => {
    const ctx = await setup();
    const hoje = storeToday();
    const ontem = storeToday(new Date(Date.now() - 86_400_000));
    const amanha = storeToday(new Date(Date.now() + 86_400_000));
    const velho = await coupon(ctx, { code: "VELHO", discountType: "FIXED", discountValue: 100, expiresAt: ontem });
    expect([velho.statusCode, json(velho).code]).toEqual([400, "COUPON_EXPIRY_INVALID"]);
    const passadoIso = await coupon(ctx, { code: "VELHOISO", discountType: "FIXED", discountValue: 100, expiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect([passadoIso.statusCode, json(passadoIso).code]).toEqual([400, "COUPON_EXPIRY_INVALID"]);
    const lixo = await coupon(ctx, { code: "LIXO", discountType: "FIXED", discountValue: 100, expiresAt: "ontem" });
    expect([lixo.statusCode, json(lixo).code]).toEqual([400, "COUPON_EXPIRY_INVALID"]);
    const okHoje = await coupon(ctx, { code: "HOJE", discountType: "FIXED", discountValue: 100, expiresAt: hoje });
    expect(okHoje.statusCode, okHoje.body).toBe(201);
    // guardado como o FIM do dia no fuso da loja (23:59:59.999 -03:00), nunca a meia-noite do começo
    expect(new Date(json(okHoje).coupon.expiresAt).toISOString()).toBe(new Date(`${hoje}T23:59:59.999-03:00`).toISOString());
    expect((await coupon(ctx, { code: "AMANHA", discountType: "FIXED", discountValue: 100, expiresAt: amanha })).statusCode).toBe(201);
    // o cupom de hoje vale no pedido de agora; depois do fim do dia (relógio simulado pelo banco) é recusado
    expect((await order(ctx, { couponCode: "HOJE" })).statusCode).toBe(201);
    await prisma.coupon.updateMany({ where: { storeId: ctx.storeId, code: "HOJE" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await order(ctx, { couponCode: "HOJE" })).statusCode).toBe(400);
  });

  it("textos e códigos de formato do catálogo: código inválido, valor fixo, percentual, usos e mínimo", async () => {
    const ctx = await setup();
    const code = await coupon(ctx, { code: "AB", discountType: "FIXED", discountValue: 100 });
    expect([code.statusCode, json(code).code, json(code).error]).toEqual([400, "COUPON_CODE_INVALID", "Use de 3 a 20 letras, números, hífen ou sublinhado."]);
    const fixo = await coupon(ctx, { code: "FIXO0", discountType: "FIXED", discountValue: 0 });
    expect([json(fixo).code, json(fixo).error]).toEqual(["COUPON_VALUE_INVALID", "Informe um valor maior que zero."]);
    const pct = await coupon(ctx, { code: "PCT0", discountType: "PERCENT", discountValue: 0 });
    expect([json(pct).code, json(pct).error]).toEqual(["COUPON_VALUE_INVALID", "O percentual vai de 1 a 100."]);
    const usos = await coupon(ctx, { code: "USOS0", discountType: "FIXED", discountValue: 100, maxUses: 0 });
    expect([json(usos).code, json(usos).error]).toEqual(["VALIDATION_ERROR", "Informe pelo menos 1 uso."]);
    const min = await coupon(ctx, { code: "MIN", discountType: "FIXED", discountValue: 100, minOrderCents: -1 });
    expect([json(min).code, json(min).error]).toEqual(["VALIDATION_ERROR", "Informe um valor a partir de zero."]);
  });

  // ───────────── CA-CP-16: quem mexe em cupom de 100% e quem exclui ─────────────
  async function staffCookie(ctx: Ctx) {
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: ctx.owner }, payload: { email: `staff-${Date.now()}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  }

  it("TETO DO STAFF: só até 50% ou R$ 50,00 e SEMPRE com limite de usos; acima disso (ou sem limite) ⇒ 403 FORBIDDEN_ROLE; o dono não tem teto", async () => {
    const ctx = await setup();
    const staff = await staffCookie(ctx);
    const asStaff = (url: string, payload?: Record<string, unknown>) => app.inject({ method: "POST", url, headers: { cookie: staff }, payload });
    const forbidden = async (payload: Record<string, unknown>) => {
      const r = await asStaff("/api/coupons", payload);
      expect([r.statusCode, json(r).code], JSON.stringify(payload)).toEqual([403, "FORBIDDEN_ROLE"]);
    };
    await forbidden({ code: "ENORME", discountType: "FIXED", discountValue: 999_900, maxUses: 5 }); // R$ 9.999
    await forbidden({ code: "NOVENTA", discountType: "PERCENT", discountValue: 99 }); // 99% sem limite zera o pedido
    await forbidden({ code: "CINQ1", discountType: "PERCENT", discountValue: 51, maxUses: 5 });
    await forbidden({ code: "CINQUENTA1", discountType: "FIXED", discountValue: 5001, maxUses: 5 });
    await forbidden({ code: "SEMLIM", discountType: "PERCENT", discountValue: 10 }); // dentro do teto, mas sem limite de usos
    await forbidden({ code: "SEMLIMF", discountType: "FIXED", discountValue: 100 });
    await forbidden({ code: "MUITOSUSOS", discountType: "PERCENT", discountValue: 10, maxUses: 501 }); // limite de usos também tem teto (500)
    const negado = await asStaff("/api/coupons", { code: "TEXTO", discountType: "PERCENT", discountValue: 60, maxUses: 5 });
    expect(json(negado).error).toBe("Acima do seu limite. Peça ao dono.");
    expect(await prisma.coupon.count({ where: { storeId: ctx.storeId } })).toBe(0);
    // no teto, com limite: pode
    expect((await asStaff("/api/coupons", { code: "METADE", discountType: "PERCENT", discountValue: 50, maxUses: 3 })).statusCode).toBe(201);
    expect((await asStaff("/api/coupons", { code: "CINQUENTA", discountType: "FIXED", discountValue: 5000, maxUses: 3 })).statusCode).toBe(201);
    expect((await asStaff("/api/coupons", { code: "QUINHENTOS", discountType: "PERCENT", discountValue: 5, maxUses: 500 })).statusCode).toBe(201);
    // o dono cria acima do teto e sem limite (99%); o STAFF não consegue editá-lo (nem para baixar o valor sem declarar limite)
    const dono = await coupon(ctx, { code: "DONO99", discountType: "PERCENT", discountValue: 99 });
    expect(dono.statusCode, dono.body).toBe(201);
    const donoId = json(dono).coupon.id as string;
    for (const payload of [{ discountValue: 10 }, { maxUses: 2 }, { discountValue: 10, maxUses: 2 }, { expiresAt: "2099-01-01" }]) {
      const r = await asStaff(`/api/coupons/${donoId}`, payload);
      expect([r.statusCode, json(r).code], JSON.stringify(payload)).toEqual([403, "FORBIDDEN_ROLE"]);
    }
    // PARAR um cupom perigoso reduz risco: o STAFF pode DESATIVAR (só isso) o cupom do dono acima do teto; reativar e misturar, não
    const desativa = await asStaff(`/api/coupons/${donoId}`, { active: false });
    expect(desativa.statusCode, desativa.body).toBe(200);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: donoId } })).active).toBe(false);
    const reativa = await asStaff(`/api/coupons/${donoId}`, { active: true });
    expect([reativa.statusCode, json(reativa).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    const mistura = await asStaff(`/api/coupons/${donoId}`, { active: false, discountValue: 10 });
    expect([mistura.statusCode, json(mistura).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: donoId } })).discountValue).toBe(99);
    // a exceção é estreita: a chave `active` SOZINHA; `active:false` com validade (ou qualquer outro campo) ⇒ 403
    const comValidade = await asStaff(`/api/coupons/${donoId}`, { active: false, expiresAt: "2099-01-01" });
    expect([comValidade.statusCode, json(comValidade).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: donoId } })).expiresAt).toBeNull();
    // desativar cupom já inativo é idempotente
    expect((await asStaff(`/api/coupons/${donoId}`, { active: false })).statusCode).toBe(200);
    // cupom de OUTRA loja não existe para este STAFF (404), nem para desativar
    const outra = await setup();
    const alheio = json(await coupon(outra, { code: "ALHEIO", discountType: "PERCENT", discountValue: 10 })).coupon.id as string;
    expect((await asStaff(`/api/coupons/${alheio}`, { active: false })).statusCode).toBe(404);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: alheio } })).active).toBe(true);
    // reativar DENTRO do teto é permitido ao STAFF (reduzir risco não é o caso, mas o cupom é dele)
    const dentro = json(await asStaff("/api/coupons", { code: "DENTRO", discountType: "PERCENT", discountValue: 10, maxUses: 4 })).coupon.id as string;
    expect((await asStaff(`/api/coupons/${dentro}`, { active: false })).statusCode).toBe(200);
    expect((await asStaff(`/api/coupons/${dentro}`, { active: true })).statusCode).toBe(200);
    // o STAFF não consegue ESTOURAR o teto editando um cupom dele
    const meu = json(await asStaff("/api/coupons", { code: "MEU", discountType: "PERCENT", discountValue: 10, maxUses: 4 })).coupon.id as string;
    expect((await asStaff(`/api/coupons/${meu}`, { discountValue: 51 })).statusCode).toBe(403);
    expect((await asStaff(`/api/coupons/${meu}`, { discountType: "FIXED", discountValue: 9000 })).statusCode).toBe(403);
    expect((await asStaff(`/api/coupons/${meu}`, { discountValue: 40 })).statusCode).toBe(200);
    // o dono mexe em tudo
    expect((await app.inject({ method: "POST", url: `/api/coupons/${donoId}`, headers: { cookie: ctx.owner }, payload: { discountValue: 10 } })).statusCode).toBe(200);
    expect((await coupon(ctx, { code: "DONOFIXO", discountType: "FIXED", discountValue: 999_900 })).statusCode).toBe(201);
  });

  it("CA-CP-16: STAFF cria/edita cupom abaixo de 100% e fixo, mas NÃO cria 100%, NÃO mexe em 100% (nem reativa/define limite) e NÃO exclui nada ⇒ 403 FORBIDDEN_ROLE; OWNER pode e fica na auditoria", async () => {
    const ctx = await setup();
    const staff = await staffCookie(ctx);
    const asStaff = (url: string, payload?: Record<string, unknown>) => app.inject({ method: "POST", url, headers: { cookie: staff }, payload });

    const normal = await asStaff("/api/coupons", { code: "NORMAL", discountType: "PERCENT", discountValue: 20, maxUses: 10 });
    expect(normal.statusCode, normal.body).toBe(201);
    const normalId = json(normal).coupon.id as string;
    expect((await asStaff("/api/coupons", { code: "FIXOX", discountType: "FIXED", discountValue: 500, maxUses: 10 })).statusCode).toBe(201);
    expect((await asStaff(`/api/coupons/${normalId}`, { discountValue: 30 })).statusCode).toBe(200);

    const free = await asStaff("/api/coupons", { code: "GRATIS", discountType: "PERCENT", discountValue: 100, maxUses: 5 });
    expect([free.statusCode, json(free).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    const toFree = await asStaff(`/api/coupons/${normalId}`, { discountValue: 100, maxUses: 5 });
    expect([toFree.statusCode, json(toFree).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: normalId } })).discountValue).toBe(30);

    // o dono cria o 100%; STAFF não reativa, não define limite e não exclui
    const ownerFree = await coupon(ctx, { code: "DONO100", discountType: "PERCENT", discountValue: 100, maxUses: 2 });
    expect(ownerFree.statusCode, ownerFree.body).toBe(201);
    const freeId = json(ownerFree).coupon.id as string;
    await prisma.coupon.update({ where: { id: freeId }, data: { active: false } });
    for (const payload of [{ active: true }, { maxUses: 50 }]) {
      const r = await asStaff(`/api/coupons/${freeId}`, payload);
      expect([r.statusCode, json(r).code], JSON.stringify(payload)).toEqual([403, "FORBIDDEN_ROLE"]);
    }
    const del = await asStaff(`/api/coupons/${normalId}/delete`);
    expect([del.statusCode, json(del).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    expect(await prisma.coupon.count({ where: { storeId: ctx.storeId } })).toBe(3);

    // OWNER: reativa, define limite e exclui; tudo auditado, só código e valor (nada de dado de cliente)
    expect((await app.inject({ method: "POST", url: `/api/coupons/${freeId}`, headers: { cookie: ctx.owner }, payload: { active: true, maxUses: 50 } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/coupons/${normalId}/delete`, headers: { cookie: ctx.owner } })).statusCode).toBe(200);
    await vi.waitFor(async () => {
      const rows = await prisma.auditLog.findMany({ where: { storeId: ctx.storeId, action: { in: ["coupon.create", "coupon.update", "coupon.delete"] } } });
      expect(rows.map((r) => r.action).sort()).toEqual(["coupon.create", "coupon.create", "coupon.create", "coupon.delete", "coupon.update", "coupon.update"]);
      for (const row of rows) {
        expect(Object.keys(row.metadata as object).sort()).toEqual(row.action === "coupon.delete" ? ["code", "discountType", "discountValue"] : ["active", "code", "discountType", "discountValue", "maxUses"]);
      }
    }, { timeout: 10_000, interval: 100 }); // a auditoria do cupom é gravada sem await: sob carga passava de 1 s (padrão)
  });

  // ───────────── FUNC-02: total zero ─────────────
  it("CA-CP-05: retirada de R$ 40,00 com cupom 100% ⇒ total 0, SEM cobrança (provedor NUNCA chamado), sem forma de pagamento, sem awaitingPayment, sem QR — mesmo com PIX e troco", async () => {
    const ctx = await setup(4000);
    await coupon(ctx, { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 10 });
    const r = await order(ctx, { couponCode: "TUDO", paymentMethod: "PIX", changeForCents: 5000 });
    expect(r.statusCode, r.body).toBe(201);
    // sem cobrança na resposta: nenhuma chave de pagamento/QR/PIX (outras chaves, como o token de acompanhamento da NG-16, podem existir)
    expect(Object.keys(json(r)).filter((k) => /payment|qr|pix/i.test(k))).toEqual([]);
    expect(json(r)).toMatchObject({ orderId: expect.any(String), code: expect.any(String) });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(r).orderId }, include: { payment: true } });
    expect(o).toMatchObject({ subtotalCents: 4000, discountCents: 4000, totalCents: 0, paymentMethod: null, changeForCents: null, awaitingPayment: false, payment: null });
    expect(vi.mocked(mp.createPixPayment)).not.toHaveBeenCalled();
    expect(await usedCount("TUDO", ctx.storeId)).toBe(1); // o cupom conta
    // o tíquete nasce normal (vai para a cozinha como qualquer pedido sem pagamento online)
    expect(await prisma.printJob.count({ where: { orderId: o.id, kind: "ORDER_KITCHEN" } })).toBe(1);
  });

  it("total zero também com FIXED que cobre o subtotal (desconto limitado ao subtotal) e com forma DINHEIRO/CREDITO informada: ignorada", async () => {
    const ctx = await setup(3000);
    await coupon(ctx, { code: "CINQ", discountType: "FIXED", discountValue: 5000, maxUses: 5 });
    for (const paymentMethod of ["DINHEIRO", "CREDITO", undefined]) {
      const r = await order(ctx, { couponCode: "CINQ", ...(paymentMethod ? { paymentMethod } : {}) });
      expect(r.statusCode, r.body).toBe(201);
      const o = await prisma.order.findUniqueOrThrow({ where: { id: json(r).orderId } });
      expect([o.discountCents, o.totalCents, o.paymentMethod]).toEqual([3000, 0, null]);
    }
  });

  it("CA-CP-06: entrega de R$ 40,00 com taxa de R$ 6,00 e cupom 100% ⇒ total R$ 6,00 (cupom não desconta a taxa) e segue o fluxo normal, inclusive PIX", async () => {
    const ctx = await setup(4000, { deliveryFeeCents: 600 });
    await coupon(ctx, { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 10 });
    vi.mocked(mp.createPixPayment).mockResolvedValue({ providerPaymentId: "p-1", pixQrCode: "qr", pixQrCodeBase64: "b64", expiresAt: new Date(Date.now() + 600_000) } as never);
    const r = await order(ctx, { type: "DELIVERY", customerName: "Ana", customerPhone: "11987654321", address: "Rua A, 1", couponCode: "TUDO", paymentMethod: "PIX" });
    expect(r.statusCode, r.body).toBe(201);
    expect(json(r).payment).toMatchObject({ pixQrCode: "qr" });
    expect(vi.mocked(mp.createPixPayment)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mp.createPixPayment).mock.calls[0][0]).toMatchObject({ amountCents: 600 });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(r).orderId } });
    expect([o.discountCents, o.totalCents, o.paymentMethod, o.awaitingPayment]).toEqual([4000, 600, "PIX", true]);
  });

  it("total zero por gorjeta: cupom 100% com gorjeta ⇒ total = gorjeta (> 0) e segue normal; nunca vira total zero", async () => {
    const ctx = await setup(4000);
    await coupon(ctx, { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 10 });
    const r = await order(ctx, { couponCode: "TUDO", tipCents: 300, paymentMethod: "DINHEIRO", changeForCents: 500 });
    expect(r.statusCode, r.body).toBe(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(r).orderId } });
    expect([o.totalCents, o.paymentMethod, o.changeForCents]).toEqual([300, "DINHEIRO", 500]);
  });

  it("CA-CP-11: o desconto incide só sobre os itens (FIXED de R$ 50,00 em itens de R$ 30,00 desconta R$ 30,00); taxa e gorjeta ficam fora da base", async () => {
    const ctx = await setup(3000, { deliveryFeeCents: 400 });
    await coupon(ctx, { code: "CINQ", discountType: "FIXED", discountValue: 5000, maxUses: 5 });
    const r = await order(ctx, { type: "DELIVERY", customerName: "Ana", customerPhone: "11987654321", address: "Rua A, 1", couponCode: "CINQ", tipCents: 200, paymentMethod: "DINHEIRO" });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: json(r).orderId } });
    expect([o.subtotalCents, o.discountCents, o.deliveryFeeCents, o.tipCents, o.totalCents]).toEqual([3000, 3000, 400, 200, 600]);
  });

  it("CA-CP-08: relatório e caixa contam o pedido de R$ 0,00 em \"Sem cobrança\" e somam o desconto; o caixa não ganha dinheiro", async () => {
    const ctx = await setup(4000);
    await coupon(ctx, { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 10 });
    const id = json(await order(ctx, { couponCode: "TUDO" })).orderId as string;
    await order(ctx, { paymentMethod: "DINHEIRO" }); // venda normal de R$ 40,00
    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]) {
      await app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie: ctx.owner }, payload: { to } });
    }
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const rep = json(await app.inject({ method: "GET", url: `/api/reports/summary?from=${today}&to=${today}`, headers: { cookie: ctx.owner } }));
    const text = JSON.stringify(rep);
    expect(text).toContain("SEM_COBRANCA");
    expect(text).not.toContain("NAO_IDENTIFICADO");
    expect(rep.byPaymentMethod?.SEM_COBRANCA ?? rep.summary?.byPaymentMethod?.SEM_COBRANCA).toMatchObject({ count: 1, revenueCents: 0 });
    expect(rep.discountCents ?? rep.summary?.discountCents).toBe(4000);
  });

  it("CA-CP-09: cancelar pedido de total zero ⇒ sem estorno, sem linha de dinheiro, o cupom volta UMA vez", async () => {
    const ctx = await setup(4000);
    await coupon(ctx, { code: "TUDO", discountType: "PERCENT", discountValue: 100, maxUses: 1 });
    const id = json(await order(ctx, { couponCode: "TUDO" })).orderId as string;
    const cancel = () => app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    const r = await cancel();
    expect(r.statusCode, r.body).toBe(200);
    expect(vi.mocked(mp.refundPayment)).not.toHaveBeenCalled();
    expect(vi.mocked(mp.cancelPayment)).not.toHaveBeenCalled();
    expect(await prisma.payment.count({ where: { orderId: id } })).toBe(0);
    expect(await usedCount("TUDO", ctx.storeId)).toBe(0);
    await cancel();
    expect(await usedCount("TUDO", ctx.storeId)).toBe(0); // não devolve duas vezes (nunca negativo)
  });
});
