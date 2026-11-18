// API-27b — caixa parte 2: esperado/diferença de 64 bits (CA-CX-29, teste Q5b do Deming) e idempotência da movimentação (M3, Idempotency-Key).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("API-27b — caixa: Int8 e idempotência", () => {
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
  const INT32_MAX = 2_147_483_647;

  async function setup(opening = 0) {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const open = await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: cookie! }, payload: { openingBalanceCents: opening } });
    expect(open.statusCode, open.body).toBe(201);
    return { owner: cookie!, store, sessionId: json(open).session.id as string };
  }
  const move = (cookie: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: "/api/cashier/movements", headers: { cookie, ...headers }, payload });
  const fechar = (cookie: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/cashier/close", headers: { cookie }, payload });
  const movimentos = (sessionId: string) => prisma.cashMovement.count({ where: { cashSessionId: sessionId } });
  const suprimento = { type: "SUPRIMENTO", amountCents: 5000, reason: "TROCO" };

  // ───────────── Int8 (Q5b) ─────────────
  it("Q5b / CA-CX-29: caixa com VENDAS + suprimentos acima de 2^31-1 centavos fecha com 200; esperado e diferença saem como número seguro", async () => {
    const c = await setup(0);
    const user = await prisma.user.findFirstOrThrow({ where: { storeId: c.store.id } });
    // vendas em dinheiro recebidas dentro do caixa: 2 x R$ 10.000.000,00 (cada pedido cabe em Int) = 2.000.000.000 centavos
    for (let i = 0; i < 2; i++) {
      await prisma.order.create({
        data: { storeId: c.store.id, code: `Q${i}`, type: "BALCAO", status: "CONCLUIDO", paymentMethod: "DINHEIRO", paidAt: new Date(), subtotalCents: 1_000_000_000, totalCents: 1_000_000_000, customerName: "x" },
      });
    }
    // + suprimentos (R$ 1.000.000,00 cada, o teto do lançamento) para passar de 2^31-1 somando com as vendas
    for (let i = 0; i < 2; i++) expect((await move(c.owner, { type: "SUPRIMENTO", amountCents: 100_000_000, reason: "APORTE_DONO" })).statusCode).toBe(201);
    void user;
    const esperado = 2_000_000_000 + 200_000_000;
    expect(esperado).toBeGreaterThan(INT32_MAX);
    const r = await fechar(c.owner, { closingBalanceCents: 100_000_000, reason: "ERRO_CONTAGEM" });
    expect(r.statusCode, r.body).toBe(200);
    const body = json(r);
    expect(body.session.expectedClosingCents).toBe(esperado);
    expect(body.differenceCents).toBe(100_000_000 - esperado);
    expect(body.session.differenceCents).toBe(100_000_000 - esperado);
    const gravado = await prisma.cashSession.findUniqueOrThrow({ where: { id: c.sessionId } });
    expect(gravado.expectedClosingCents).toBe(BigInt(esperado)); // 64 bits no banco
    // o histórico do dono também devolve número (nunca BigInt cru, que quebraria o JSON)
    const lista = await app.inject({ method: "GET", url: "/api/cashier/sessions", headers: { cookie: c.owner } });
    expect(lista.statusCode, lista.body).toBe(200);
    expect(lista.body).toContain(String(esperado));
  });

  it("safeCents: número seguro vira number; acima de MAX_SAFE_INTEGER vira texto; nulo continua nulo", async () => {
    const { safeCents } = await import("../src/routes/cashier");
    expect(safeCents(null)).toBeNull();
    expect(safeCents(BigInt(INT32_MAX) + 1n)).toBe(INT32_MAX + 1);
    expect(safeCents(-5n)).toBe(-5);
    expect(safeCents(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBe("9007199254740992");
  });

  // ───────────── Idempotência (M3) ─────────────
  it("M3: a mesma Idempotency-Key repetida devolve a MESMA movimentação (200), sem novo lançamento nem nova auditoria", async () => {
    const c = await setup(0);
    const h = { "idempotency-key": "chave-0001-abcdef" };
    const a = await move(c.owner, suprimento, h);
    expect(a.statusCode, a.body).toBe(201);
    const b = await move(c.owner, suprimento, h);
    expect(b.statusCode, b.body).toBe(200);
    expect(b.headers["idempotent-replay"]).toBe("true");
    expect(json(b).movement.id).toBe(json(a).movement.id);
    expect(await movimentos(c.sessionId)).toBe(1);
    expect(await prisma.auditLog.count({ where: { storeId: c.store.id, action: "cashier.movement" } })).toBe(1);
  });

  it("M3: duplo clique (simultâneo) com a mesma chave cria UMA só movimentação", async () => {
    const c = await setup(0);
    const h = { "idempotency-key": "chave-duplo-clique-1" };
    const rs = await Promise.all([1, 2, 3, 4].map(() => move(c.owner, suprimento, h)));
    for (const r of rs) expect([200, 201], r.body).toContain(r.statusCode);
    expect(await movimentos(c.sessionId)).toBe(1);
  });

  it("M3: mesma chave com conteúdo diferente => 409 IDEMPOTENCY_KEY_REUSED e nada novo", async () => {
    const c = await setup(0);
    const h = { "idempotency-key": "chave-reusada-001" };
    expect((await move(c.owner, suprimento, h)).statusCode).toBe(201);
    const r = await move(c.owner, { ...suprimento, amountCents: 6000 }, h);
    expect(r.statusCode).toBe(409);
    expect(json(r).code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await movimentos(c.sessionId)).toBe(1);
  });

  it("M3: chaves diferentes criam movimentações diferentes; sem chave segue como antes (cada chamada cria uma)", async () => {
    const c = await setup(0);
    expect((await move(c.owner, suprimento, { "idempotency-key": "chave-aaaaaaaa-1" })).statusCode).toBe(201);
    expect((await move(c.owner, suprimento, { "idempotency-key": "chave-aaaaaaaa-2" })).statusCode).toBe(201);
    expect((await move(c.owner, suprimento)).statusCode).toBe(201);
    expect((await move(c.owner, suprimento)).statusCode).toBe(201);
    expect(await movimentos(c.sessionId)).toBe(4);
  });

  it("M3: chave malformada => 400 e nada criado; a sangria repetida com a mesma chave NÃO reavalia o saldo nem sangra duas vezes", async () => {
    const c = await setup(10000);
    expect((await move(c.owner, suprimento, { "idempotency-key": "curta" })).statusCode).toBe(400);
    expect((await move(c.owner, suprimento, { "idempotency-key": "tem espaco e !!" })).statusCode).toBe(400);
    expect(await movimentos(c.sessionId)).toBe(0);
    const h = { "idempotency-key": "sangria-unica-0001" };
    const sangria = { type: "SANGRIA", amountCents: 10000, reason: "RETIRADA_DONO" };
    expect((await move(c.owner, sangria, h)).statusCode).toBe(201);
    const again = await move(c.owner, sangria, h); // sem a chave, a 2ª falharia por saldo insuficiente; com ela é só a repetição
    expect(again.statusCode, again.body).toBe(200);
    expect(await movimentos(c.sessionId)).toBe(1);
  });

  it("M3: a chave vale por caixa — no caixa seguinte a mesma chave cria nova movimentação", async () => {
    const c = await setup(0);
    const h = { "idempotency-key": "chave-por-caixa-01" };
    expect((await move(c.owner, suprimento, h)).statusCode).toBe(201);
    expect((await fechar(c.owner, { closingBalanceCents: 5000 })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: c.owner }, payload: { openingBalanceCents: 0 } })).statusCode).toBe(201);
    expect((await move(c.owner, suprimento, h)).statusCode).toBe(201);
  });
});
