// QA-28 (Deming) — API-54/API-62: kanban, histórico e observação interna. Sondas independentes das do Babbage.
// API-70 (Babbage): H1 e H3 corrigidos, agora são testes normais; H2 e H6 seguem as regras novas (teto e janela do STAFF).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { resetHistoryRate, searchOrderHistory } from "../../src/modules/orders/orders.history";
import { login, makeApp, registerStore, resetDb } from "../helpers";

vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const DAY = 24 * 3_600_000;

describe("QA-28 kanban e histórico (API-54/62)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    vi.clearAllMocks();
    resetHistoryRate();
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
  let seq = 0;

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const invited = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: `staff-${Date.now()}-${seq++}@t.com`, password: "provisoria1" } });
    const staff = (await login(app, json(invited).user.email, "provisoria1")).cookie!;
    return { owner: cookie!, staff, storeId };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  async function mk(ctx: Pick<Ctx, "storeId">, data: { createdAt?: Date; status?: "PENDENTE" | "CONCLUIDO" | "CANCELADO"; name?: string; phone?: string; code?: string } = {}) {
    seq += 1;
    const createdAt = data.createdAt ?? new Date();
    const order = await prisma.order.create({
      data: {
        storeId: ctx.storeId, code: data.code ?? String(seq).padStart(4, "0"), type: "BALCAO", status: data.status ?? "PENDENTE",
        customerName: data.name ?? "Cliente", customerPhone: data.phone ?? "11987654321", totalCents: 1500, awaitingPayment: false, createdAt, updatedAt: createdAt,
      },
    });
    return order.id;
  }
  const kanban = async (cookie: string) => json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie } }));
  const hist = async (cookie: string, qs: string) => json(await app.inject({ method: "GET", url: `/api/orders/history${qs}`, headers: { cookie } }));

  it("H1 pedido LEGADO (encerrado há dias, sem histórico de encerramento) NÃO volta ao 'hoje' do kanban só porque a equipe anotou uma observação interna", async () => {
    const ctx = await setup();
    const velho = await mk(ctx, { createdAt: new Date(Date.now() - 3 * DAY), status: "CONCLUIDO" });
    expect((await kanban(ctx.owner)).orders.map((o: { id: string }) => o.id)).not.toContain(velho);
    const r = await app.inject({ method: "POST", url: `/api/orders/${velho}/internal-note`, headers: { cookie: ctx.owner }, payload: { note: "cliente pediu a nota" } });
    expect(r.statusCode, r.body).toBe(200);
    // a anotação muda `updatedAt` e o pedido sem registro de encerramento passa a valer como "encerrado hoje"
    expect((await kanban(ctx.owner)).orders.map((o: { id: string }) => o.id), "o pedido de 3 dias atrás reapareceu no kanban de hoje").not.toContain(velho);
  });

  it("H2 mais de 500 pedidos abertos de dias anteriores: o kanban devolve 500 (os mais antigos), avisa com openCapped/openHidden; o aberto de HOJE nunca some", async () => {
    const ctx = await setup();
    const base = Date.now() - 2 * DAY;
    await prisma.order.createMany({
      data: Array.from({ length: 502 }, (_, i) => ({
        storeId: ctx.storeId, code: `P${String(i).padStart(4, "0")}`, type: "BALCAO" as const, status: "PENDENTE" as const, customerName: "Cliente",
        totalCents: 1500, awaitingPayment: false, createdAt: new Date(base + i * 1000), updatedAt: new Date(base + i * 1000),
      })),
    });
    const k = await kanban(ctx.owner);
    expect(k.openCount).toBe(500);
    expect(k.openCapped).toBe(true);
    const codes = new Set(k.orders.map((o: { code: string }) => o.code));
    expect(codes.has("P0000"), "o mais antigo fica").toBe(true);
    expect(codes.has("P0501"), "o mais novo DOS ANTIGOS fica de fora; o aviso openCapped/openHidden diz que há mais").toBe(false);
    expect(k.openHidden).toBe(2);
  });

  it("H3 busca por nome: acento, cedilha, caixa e Unicode DECOMPOSTO (NFD) casam com a mesma pessoa", async () => {
    const ctx = await setup();
    const nfc = await mk(ctx, { name: "Conceição Álvares" });
    const nfd = await mk(ctx, { name: "Conceição Álvares".normalize("NFD") }); // c + cedilha combinante, a + til combinante
    for (const q of ["conceicao", "CONCEIÇÃO", "conceição", "alvares", "álvares", "Conceição".normalize("NFD")]) {
      const ids = (await hist(ctx.owner, `?q=${encodeURIComponent(q)}`)).rows.map((r: { id: string }) => r.id);
      expect(ids, `NFC com "${q}"`).toContain(nfc);
      expect(ids, `NFD com "${q}"`).toContain(nfd);
    }
  });

  it("H4 virada do dia no FUSO DA LOJA: 02:59:59.999Z ainda é o dia anterior em São Paulo e 03:00:00.000Z já é hoje; e o dia de 23 h do horário de verão (Nova York)", async () => {
    const ctx = await setup();
    const antes = await mk(ctx, { createdAt: new Date("2026-11-17T02:59:59.999Z") });
    const depois = await mk(ctx, { createdAt: new Date("2026-11-17T03:00:00.000Z") });
    const agora = new Date("2026-11-17T15:00:00Z");
    const idsDe = async (period: "today" | "yesterday") => (await searchOrderHistory(prisma, ctx.storeId, "America/Sao_Paulo", agora, { period, limit: 100 })).rows.map((r) => r.id);
    expect(await idsDe("today")).toEqual([depois]);
    expect(await idsDe("yesterday")).toEqual([antes]);
    // Nova York, domingo 08/03/2026: o relógio atrasa 1 h às 02:00 local, o dia tem 23 h (05:00Z → 04:00Z do dia seguinte)
    const nyAntes = await mk(ctx, { createdAt: new Date("2026-03-09T03:59:59.999Z") });
    const nyDepois = await mk(ctx, { createdAt: new Date("2026-03-09T04:00:00.000Z") });
    const nyNow = new Date("2026-03-09T03:30:00Z"); // ainda 23:30 de domingo em Nova York
    const ny = await searchOrderHistory(prisma, ctx.storeId, "America/New_York", nyNow, { period: "today", limit: 100 });
    expect(ny.rows.map((r) => r.id)).toContain(nyAntes);
    expect(ny.rows.map((r) => r.id)).not.toContain(nyDepois);
    expect(ny.period).toEqual({ from: "2026-03-08T05:00:00.000Z", to: "2026-03-09T04:00:00.000Z" });
  });

  it("H5 fuso inválido gravado na loja nunca derruba o painel (cai em São Paulo): kanban e histórico respondem 200", async () => {
    const ctx = await setup();
    await prisma.$executeRawUnsafe(`UPDATE "Store" SET "timezone" = 'Marte/Olimpo' WHERE "id" = '${ctx.storeId}'`);
    await mk(ctx);
    expect((await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: ctx.owner } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/orders/history", headers: { cookie: ctx.owner } })).statusCode).toBe(200);
  });

  it("H6 telefone do STAFF: 4 finais e número completo acham; o que sobra é adivinhar os dígitos DESCONHECIDOS do número (celular BR: 4 dígitos ⇒ 10 mil buscas), e cada busca deixa auditoria", async () => {
    const ctx = await setup();
    const id = await mk(ctx, { phone: "11987654321" }); // máscara mostra 4321; DDD e o 9 são previsíveis; faltam 8765
    const acha = async (q: string) => (await hist(ctx.staff, `?q=${encodeURIComponent(q)}`)).rows.map((r: { id: string }) => r.id).includes(id);
    expect(await acha("4321")).toBe(true); // o que a máscara já mostra
    expect(await acha("87654321")).toBe(false); // 8 dígitos: não é critério para o STAFF
    expect(await acha("11987654321")).toBe(true); // número completo: o oráculo existe por desenho
    expect(await acha("11999994321")).toBe(false); // palpite errado nos dígitos desconhecidos
    expect(await acha("11987654320")).toBe(false); // e errado também no último
    // a auditoria é ESTRITA (gravada antes da resposta); o waitFor só dá folga ao relógio do teste
    await vi.waitFor(async () => {
      const rastros = await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "order.history_phone_search" } });
      expect(rastros, "cada busca por telefone do STAFF grava 1 linha de contagem (sem os dígitos)").toBeGreaterThanOrEqual(3);
    }, { timeout: 10_000, interval: 100 });
  });

  it("H7 a nota interna aparece só no DETALHE e some do kanban, do histórico e do detalhe da outra loja", async () => {
    const ctx = await setup();
    const other = await setup();
    const id = await mk(ctx);
    expect((await app.inject({ method: "POST", url: `/api/orders/${id}/internal-note`, headers: { cookie: ctx.staff }, payload: { note: "NOTA-SECRETA-QA" } })).statusCode).toBe(200);
    expect(JSON.stringify(await kanban(ctx.owner))).not.toContain("NOTA-SECRETA-QA");
    expect(JSON.stringify(await hist(ctx.owner, ""))).not.toContain("NOTA-SECRETA-QA");
    const det = await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: ctx.owner } });
    expect(det.body).toContain("NOTA-SECRETA-QA");
    expect((await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: other.owner } })).statusCode).toBe(404);
  });
});
