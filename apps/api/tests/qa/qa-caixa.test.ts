// QA-05 (parte de API) — regras do caixa (especificacao-caixa.md; ADR-0012 §7; bugs B22/B23). Sondas do Deming; todas it() porque a API-27 as cumpre.
// O motivo da movimentação é `reason` (código da lista do tipo) + `reasonText` (só no OUTRO), como no contrato final da API-27.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

const motivo = { notes: "teste QA", reason: "OUTRO", reasonText: "teste QA" };

describe("QA caixa (API)", () => {
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

  async function loja() {
    const { cookie } = await registerStore(app);
    const open = await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie: cookie! }, payload: { openingBalanceCents: 10000 } });
    expect(open.statusCode).toBe(201);
    return cookie!;
  }
  const mover = (cookie: string, type: "SUPRIMENTO" | "SANGRIA", amountCents: number, extra: object = motivo) =>
    app.inject({ method: "POST", url: "/api/cashier/movements", headers: { cookie }, payload: { type, amountCents, ...extra } });

  it("D28b (controle) sangria IGUAL ao dinheiro em caixa é aceita", async () => {
    const cookie = await loja();
    expect((await mover(cookie, "SANGRIA", 10000)).statusCode).toBe(201);
  });

  it("D28 (CA-CX-05) sangria MAIOR que o dinheiro em caixa ⇒ 409 CASH_WITHDRAWAL_EXCEEDS_BALANCE", async () => {
    const cookie = await loja();
    const res = await mover(cookie, "SANGRIA", 20000);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("CASH_WITHDRAWAL_EXCEEDS_BALANCE");
  });

  it("D28c (CA-CX-05) depois de um suprimento o limite sobe: 100 + 20 aceita sangria de 120, recusa 120,01", async () => {
    const cookie = await loja();
    expect((await mover(cookie, "SUPRIMENTO", 2000)).statusCode).toBe(201);
    expect((await mover(cookie, "SANGRIA", 12001)).statusCode).toBe(409);
    expect((await mover(cookie, "SANGRIA", 12000)).statusCode).toBe(201);
  });

  it("D29 (RN-CX-18 / CA-CX-09) dois fechamentos simultâneos ⇒ um 200 e um 409 CASH_ALREADY_CLOSED", async () => {
    const cookie = await loja();
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/cashier/close", headers: { cookie }, payload: { closingBalanceCents: 10000 } }),
      app.inject({ method: "POST", url: "/api/cashier/close", headers: { cookie }, payload: { closingBalanceCents: 10000 } }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(JSON.parse(loser.body).code).toBe("CASH_ALREADY_CLOSED");
    expect(await prisma.cashSession.count({ where: { closedAt: { not: null } } })).toBe(1);
  });

  it("D30 (RN-CX-07 / CA-CX-06) movimentação SEM motivo ⇒ 400", async () => {
    const cookie = await loja();
    const res = await mover(cookie, "SANGRIA", 1000, {});
    expect(res.statusCode).toBe(400);
  });

  it("D31 (RN-CX-19 / CA-CX-13) caixa fechado não reabre: fechar de novo é recusado e movimentar sem caixa aberto dá 409 CASH_REQUIRED", async () => {
    const cookie = await loja();
    expect((await app.inject({ method: "POST", url: "/api/cashier/close", headers: { cookie }, payload: { closingBalanceCents: 10000 } })).statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: "/api/cashier/close", headers: { cookie }, payload: { closingBalanceCents: 10000 } });
    expect([404, 409]).toContain(again.statusCode);
    const afterClose = await mover(cookie, "SUPRIMENTO", 500);
    expect(afterClose.statusCode).toBe(409);
    expect(JSON.parse(afterClose.body).code).toBe("CASH_REQUIRED");
  });

  it("D32 (CA-CX-15) outra loja não vê nem fecha o caixa desta", async () => {
    const cookieA = await loja();
    const { cookie: cookieB } = await registerStore(app, { slug: "loja-b-caixa", code: "LBC", email: "b-caixa@teste.com" });
    const atual = JSON.parse((await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: cookieB! } })).body);
    expect(atual.session).toBeNull();
    const fechar = await app.inject({ method: "POST", url: "/api/cashier/close", headers: { cookie: cookieB! }, payload: { closingBalanceCents: 0 } });
    expect(fechar.statusCode).toBe(404);
    expect(JSON.parse((await app.inject({ method: "GET", url: "/api/cashier/current", headers: { cookie: cookieA } })).body).session).not.toBeNull();
  });
});
