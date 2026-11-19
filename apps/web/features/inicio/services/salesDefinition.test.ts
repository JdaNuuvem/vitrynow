import { describe, expect, it } from "vitest";
import type { Order } from "@/core/domain/orders";
import { applySaleDefinition, awaitingInRange, isAwaitingAccept } from "./salesDefinition";
import { buildInicioMetrics, monthRange, weekRange } from "./inicioMetrics";
import type { ReportSummary } from "@/core/domain/reports";

const order = (over: Partial<Order>): Order =>
  ({ id: "o", code: "1", type: "BALCAO", status: "PENDENTE", customerName: null, totalCents: 0, items: [], delivererId: null, payment: null, createdAt: "2026-11-10T15:00:00.000Z", ...over }) as Order;

// Exemplo fechado do B14.1 (Leonardo, especificacao-onda1-restante.md): dois pedidos válidos.
//   A = itens 40,00 − desconto 4,00 + taxa 5,00 + gorjeta 2,00 = total 43,00
//   B = itens 20,00 + taxa 0 = total 20,00
// Faturamento = (43,00 − 2,00) + 20,00 = 61,00 · gorjeta 2,00 · ticket médio 30,50.
// É o que o resumo da API manda hoje: total somado (63,00), gorjeta à parte (2,00), 2 pedidos.
const closedExample = { orderCount: 2, revenueCents: 6300, tipCents: 200, byDay: [{ date: "2026-11-10", orderCount: 2, revenueCents: 6300 }] };

describe("definição única de venda (B14.1): exemplo fechado do Leonardo", () => {
  it("faturamento R$ 61,00, gorjeta R$ 2,00 e ticket médio R$ 30,50", () => {
    const figures = applySaleDefinition(closedExample, []);
    expect(figures.revenueCents).toBe(6100);
    expect(figures.tipCents).toBe(200);
    expect(figures.averageTicketCents).toBe(3050);
    expect(figures.salesCount).toBe(2);
    expect(figures.awaiting).toEqual({ count: 0, cents: 0 });
  });

  it("a gorjeta sai do faturamento mesmo sem nenhum pedido aguardando aceite", () => {
    expect(applySaleDefinition(closedExample, []).revenueCents).toBe(closedExample.revenueCents - closedExample.tipCents);
  });
});

describe("PENDENTE é 'Aguardando aceite', não venda (CA-B14-02)", () => {
  // Pedido novo de R$ 30,00 que a API ainda soma como venda: 3 pedidos, R$ 93,00.
  const withPending = { orderCount: 3, revenueCents: 9300, tipCents: 200, byDay: [{ date: "2026-11-10", orderCount: 3, revenueCents: 9300 }] };
  const pending = order({ id: "p", totalCents: 3000, tipCents: 0 });

  it("sai do faturamento, da contagem e do ticket, e aparece à parte", () => {
    const figures = applySaleDefinition(withPending, [pending]);
    expect(figures.revenueCents).toBe(6100);
    expect(figures.salesCount).toBe(2);
    expect(figures.averageTicketCents).toBe(3050);
    expect(figures.awaiting).toEqual({ count: 1, cents: 3000 });
  });

  it("a gorjeta de um pedido aguardando aceite também não conta como gorjeta de venda", () => {
    const figures = applySaleDefinition({ ...withPending, revenueCents: 9500, tipCents: 400 }, [order({ id: "p", totalCents: 3200, tipCents: 200 })]);
    expect(figures.tipCents).toBe(200); // só a da venda A
    expect(figures.revenueCents).toBe(6100);
    expect(figures.awaiting.cents).toBe(3000); // 32,00 − 2,00 de gorjeta
  });

  it("o gráfico por dia também perde o pedido aguardando aceite", () => {
    const figures = applySaleDefinition(withPending, [pending]);
    expect(figures.byDay).toEqual([{ date: "2026-11-10", orderCount: 2, revenueCents: 6300 }]);
  });

  it("o dia vale no fuso da loja: 23h50 de Brasília ainda é o mesmo dia (CA-B14-03)", () => {
    const late = order({ id: "p", totalCents: 3000, createdAt: "2026-11-11T02:50:00.000Z" }); // 23:50 de 10/11 em São Paulo
    const figures = applySaleDefinition(withPending, [late]);
    expect(figures.byDay[0]).toMatchObject({ date: "2026-11-10", orderCount: 2 });
  });

  it("sem a lista de pedidos: mantém o total menos a gorjeta e avisa que não conseguiu separar", () => {
    const figures = applySaleDefinition(withPending, null);
    expect(figures.awaitingKnown).toBe(false);
    expect(figures.revenueCents).toBe(9100);
    expect(figures.awaiting.count).toBe(0);
  });

  it("cliente que ainda aguarda pagamento (awaitingPayment) não é 'Aguardando aceite'", () => {
    expect(isAwaitingAccept(order({ awaitingPayment: true }))).toBe(false);
    expect(isAwaitingAccept(order({}))).toBe(true);
    expect(isAwaitingAccept(order({ status: "CONFIRMADO" }))).toBe(false);
  });
});

describe("resumos sem gorjeta nem pedido aguardando (não pode quebrar)", () => {
  it("API antiga sem tipCents: nada a tirar", () => {
    const figures = applySaleDefinition({ orderCount: 1, revenueCents: 2000, byDay: [] }, []);
    expect(figures).toMatchObject({ revenueCents: 2000, tipCents: 0, averageTicketCents: 2000, chartExact: true });
  });

  it("período sem vendas: ticket médio 0, sem divisão por zero e sem negativo", () => {
    const figures = applySaleDefinition({ orderCount: 0, revenueCents: 0, tipCents: 0, byDay: [] }, []);
    expect(figures.averageTicketCents).toBe(0);
    expect(figures.revenueCents).toBe(0);
  });

  it("com gorjeta em venda o gráfico avisa que ainda a inclui", () => {
    expect(applySaleDefinition(closedExample, []).chartExact).toBe(false);
  });
});

describe("recorte do período", () => {
  const range = { from: new Date("2026-11-01T03:00:00.000Z"), to: new Date("2026-11-16T15:00:00.000Z") };

  it("conta só pedidos aguardando aceite criados dentro do período, incluindo o dia final inteiro", () => {
    const inside = order({ id: "a", createdAt: "2026-11-16T22:00:00.000Z" });
    const before = order({ id: "b", createdAt: "2026-10-31T12:00:00.000Z" });
    const other = order({ id: "c", status: "EM_PREPARO", createdAt: "2026-11-05T12:00:00.000Z" });
    expect(awaitingInRange([inside, before, other], range).map((o) => o.id)).toEqual(["a"]);
  });
});

describe("buildInicioMetrics com a definição única", () => {
  const summary = (over: Partial<ReportSummary>): ReportSummary =>
    ({ from: "", to: "", orderCount: 2, revenueCents: 6300, tipCents: 200, discountCents: 400, averageTicketCents: 3150, customerCount: 2, byDay: [], byType: { BALCAO: { count: 2, revenueCents: 6300 } }, topProducts: [], byDeliverer: [], cashSummary: { sessionCount: 0, suprimentosCents: 0, sangriasCents: 0 }, ...over }) as ReportSummary;
  const now = new Date("2026-11-16T15:00:00.000Z");

  it("preserva os totais da API atual, sem subtrair pendentes e gorjeta duas vezes", () => {
    const api = summary({ ruleChangedAt: "2026-11-18T00:00:00Z", openCount: 1, openCents: 3000, revenueCents: 6100, averageTicketCents: 3050 });
    const metrics = buildInicioMetrics(api, api, now, [order({ totalCents: 3000 })]);
    expect(metrics).toMatchObject({ revenueCents: 6100, orderCount: 2, tipCents: 200, chartExact: true, awaiting: { count: 1, cents: 3000 } });
  });

  it("preserva uma resposta STAFF sem inferir valores financeiros", () => {
    const staff = summary({ openCount: 2, revenueCents: undefined, tipCents: undefined, averageTicketCents: undefined });
    const metrics = buildInicioMetrics(staff, staff, now, [order({ totalCents: 3000 })]);
    expect(metrics.revenueCents).toBeUndefined();
    expect(metrics.averageTicketCents).toBeUndefined();
    expect(metrics.awaiting).toEqual({ count: 2, cents: undefined });
  });

  it("calcula o período no dia civil da loja e evita incluir horas do dia seguinte", () => {
    const late = new Date("2026-12-01T01:00:00Z");
    expect(monthRange(late)).toEqual({ from: new Date("2026-11-01T03:00:00Z"), to: new Date("2026-11-30T03:00:00Z") });
    expect(weekRange(late).from).toEqual(new Date("2026-11-24T03:00:00Z"));
  });

  it("o Início mostra faturamento R$ 61,00, ticket R$ 30,50 e 2 vendas no exemplo fechado", () => {
    const metrics = buildInicioMetrics(summary({}), summary({}), now, []);
    expect(metrics).toMatchObject({ revenueCents: 6100, averageTicketCents: 3050, orderCount: 2, tipCents: 200 });
    expect(metrics.week).toEqual({ orderCount: 2, revenueCents: 6100 });
  });

  it("os 7 pedidos PENDENTES do achado da Da Vinci (R$ 184 em vez de R$ 30) saem do faturamento", () => {
    const pendings = Array.from({ length: 7 }, (_, index) => order({ id: `p${index}`, totalCents: 2200, tipCents: 0, createdAt: "2026-11-15T15:00:00.000Z" }));
    // API: 1 venda de R$ 30,00 + 7 pendentes de R$ 22,00 = 8 pedidos, R$ 184,00
    const raw = summary({ orderCount: 8, revenueCents: 18400, tipCents: 0, byType: { BALCAO: { count: 8, revenueCents: 18400 } } });
    const metrics = buildInicioMetrics(raw, raw, now, pendings);
    expect(metrics.revenueCents).toBe(3000);
    expect(metrics.orderCount).toBe(1);
    expect(metrics.awaiting).toEqual({ count: 7, cents: 15400 });
    expect(metrics.orderTypes.pickup).toBe(1);
  });

  it("sem a lista de pedidos o Início segue com o número da API (menos gorjeta) e marca awaitingKnown=false", () => {
    const metrics = buildInicioMetrics(summary({}), summary({}), now, null);
    expect(metrics.awaitingKnown).toBe(false);
    expect(metrics.revenueCents).toBe(6100);
  });
});
