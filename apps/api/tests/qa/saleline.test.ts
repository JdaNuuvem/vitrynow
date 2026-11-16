// QA-05 — TESTES PRIMEIRO de SaleLine / caixa / relatórios (ADR-0012 rev.1 §7, decisão PRD-09).
// Escrito ANTES da implementação (API-21/API-27). Funções puras, dados em memória: sem banco, sem rede.
//
// COMO ISSO ENTRA EM AÇÃO: este arquivo tenta carregar `src/lib/saleLines.ts`. Enquanto o módulo não existe,
// cada caso aparece como `todo` (a suíte fica verde e a lista de comportamentos fica visível). No dia em que o
// Turing criar o módulo, os casos passam a RODAR sozinhos: vermelho = a implementação diverge da regra.
//
// CONTRATO que o módulo precisa exportar (se o Turing preferir outro formato, ajuste SÓ o objeto `contract`
// abaixo, na mesma PR; o que importa são os números esperados, que vêm dos cenários fechados):
//
//   summarizeFinancials(input): { sales: SalesSummary; cash: CashSummary }
//   input = {
//     orders: SaleOrder[]; receipts: SaleReceipt[]; movements: CashMovement[];
//     cashSession: { openedAt: Date; closedAt: Date | null; openingBalanceCents: number };
//     range: { from: Date; to: Date };   // instantes, inclusivos (o chamador converte "dia da loja" em instantes)
//     timeZone: string;                  // ex.: "America/Sao_Paulo"
//     now: Date;
//   }
//   SaleOrder   = { id; type: "DELIVERY"|"BALCAO"|"MESA"; status; awaitingPayment: boolean;
//                   subtotalCents; discountCents; deliveryFeeCents; tipCents; totalCents;
//                   paymentMethod: "DINHEIRO"|"PIX"|"CREDITO"|"DEBITO"|"VR"|"VA"|null;
//                   createdAt: Date; paidAt: Date | null; receiptId: string | null }
//   SaleReceipt = { id; receivedAt: Date; totalCents; serviceFeeCents; orderIds: string[];
//                   payments: { id; method; amountCents; changeForCents?: number }[] }
//   CashMovement= { type: "SUPRIMENTO"|"SANGRIA"|"DEVOLUCAO"; amountCents; createdAt: Date }
//   SalesSummary = { count; revenueCents /* total − gorjeta */; tipCents; deliveryFeeCents; discountCents;
//                    averageTicketCents; canceledCount; canceledCents; openCount; openCents /* PENDENTE */;
//                    byType: Record<string,{count,revenueCents}>; byPaymentMethod: Record<string,{count,revenueCents}>;
//                    byDay: {date:"YYYY-MM-DD"; count; revenueCents}[] }
//   CashSummary  = { expectedCents; receivedCashCents; entriesCents; exitsCents; refundsCents;
//                    toReceiveCount; toReceiveCents }
//
// Regras (todas do ADR-0012 §7 e das specs do Leonardo): venda = CONFIRMADO|EM_PREPARO|PRONTO|SAIU_PARA_ENTREGA|
// CONCLUIDO e !awaitingPayment; PENDENTE = "em aberto"; CANCELADO à parte; faturamento = total − gorjeta;
// data da venda = criação no fuso da loja (mesa = recebimento); caixa = só dinheiro RECEBIDO (paidAt/receivedAt
// dentro da sessão) + suprimentos − sangrias − devoluções.
import { describe, expect, it } from "vitest";

type Impl = { summarizeFinancials?: (input: unknown) => { sales: any; cash: any } };
let impl: Impl | null = null;
try {
  const path = "../../src/lib/saleLines"; // variável: o vite não tenta resolver enquanto o módulo não existe
  impl = (await import(/* @vite-ignore */ path)) as Impl;
} catch {
  impl = null;
}

const TZ = "America/Sao_Paulo";
const at = (hhmm: string, day = "2026-11-16") => new Date(`${day}T${hhmm}:00-03:00`);
const DAY = { from: at("00:00"), to: new Date("2026-11-16T23:59:59.999-03:00") };

type O = Record<string, any>;
function order(o: O) {
  return {
    awaitingPayment: false,
    subtotalCents: o.totalCents - (o.deliveryFeeCents ?? 0) - (o.tipCents ?? 0) + (o.discountCents ?? 0),
    discountCents: 0,
    deliveryFeeCents: 0,
    tipCents: 0,
    paidAt: null,
    receiptId: null,
    ...o,
  };
}
const contract = {
  run(input: { orders: O[]; receipts?: O[]; movements?: O[]; session?: O; range?: O; now?: Date }) {
    return impl!.summarizeFinancials!({
      orders: input.orders.map(order),
      receipts: input.receipts ?? [],
      movements: input.movements ?? [],
      cashSession: input.session ?? { openedAt: at("10:00"), closedAt: null, openingBalanceCents: 10000 },
      range: input.range ?? DAY,
      timeZone: TZ,
      now: input.now ?? at("12:00"),
    });
  },
};

// Sem módulo: cada caso vira `todo` (visível, sem quebrar a suíte). Com módulo: roda de verdade.
const test: (name: string, fn: () => void) => void = impl ? (n, f) => it(n, f) : (n) => it.todo(n);
const group = describe;

// ───────────────────────── Cenário 1 — ADR-0012 §4 (mesa + recebimento) ─────────────────────────
const scenarioMesa = () => ({
  orders: [
    { id: "O1", type: "BALCAO", status: "CONCLUIDO", totalCents: 5000, paymentMethod: "DINHEIRO", createdAt: at("10:05"), paidAt: at("10:05") },
    { id: "O2", type: "DELIVERY", status: "CONCLUIDO", totalCents: 8000, deliveryFeeCents: 1000, paymentMethod: "PIX", createdAt: at("10:10"), paidAt: at("10:10") },
    { id: "O3", type: "BALCAO", status: "CANCELADO", totalCents: 3000, paymentMethod: "DINHEIRO", createdAt: at("10:20"), paidAt: at("10:20") },
    { id: "M1", type: "MESA", status: "CONFIRMADO", totalCents: 4000, paymentMethod: null, createdAt: at("10:30"), receiptId: "R1" },
    { id: "M2", type: "MESA", status: "CONFIRMADO", totalCents: 2500, paymentMethod: null, createdAt: at("10:40"), receiptId: "R1" },
    { id: "M3", type: "MESA", status: "CANCELADO", totalCents: 1500, paymentMethod: null, createdAt: at("10:45") },
  ],
  receipts: [
    {
      id: "R1",
      receivedAt: at("11:00"),
      totalCents: 6500,
      serviceFeeCents: 0,
      orderIds: ["M1", "M2"],
      payments: [{ id: "RP1", method: "DINHEIRO", amountCents: 6500, changeForCents: 10000 }],
    },
  ],
  movements: [
    { type: "SUPRIMENTO", amountCents: 2000, createdAt: at("10:50") },
    { type: "SANGRIA", amountCents: 3000, createdAt: at("11:10") },
  ],
});

group("QA-05 · cenário 1 (ADR-0012 §4): 3 vendas, receita R$195,00, esperado em dinheiro R$205,00", () => {
  test("relatório: 3 vendas, receita 195,00, taxa de entrega 10,00, por tipo e por forma de pagamento", () => {
    const { sales } = contract.run(scenarioMesa());
    expect(sales.count).toBe(3);
    expect(sales.revenueCents).toBe(19500);
    expect(sales.deliveryFeeCents).toBe(1000);
    expect(sales.byType.BALCAO).toMatchObject({ count: 1, revenueCents: 5000 });
    expect(sales.byType.DELIVERY).toMatchObject({ count: 1, revenueCents: 8000 });
    expect(sales.byType.MESA).toMatchObject({ count: 1, revenueCents: 6500 });
    expect(sales.byPaymentMethod.DINHEIRO).toMatchObject({ count: 2, revenueCents: 11500 });
    expect(sales.byPaymentMethod.PIX).toMatchObject({ count: 1, revenueCents: 8000 });
  });

  test("I2: cancelados à parte (2 pedidos, R$45,00) e nenhum entra na receita", () => {
    const { sales } = contract.run(scenarioMesa());
    expect(sales.canceledCount).toBe(2);
    expect(sales.canceledCents).toBe(4500);
  });

  test("caixa: esperado em dinheiro = 100 + 50 + 65 + 20 − 30 = R$205,00 (troco é irrelevante para a gaveta)", () => {
    const { cash } = contract.run(scenarioMesa());
    expect(cash.expectedCents).toBe(20500);
    expect(cash.receivedCashCents).toBe(11500);
    expect(cash.entriesCents).toBe(2000);
    expect(cash.exitsCents).toBe(3000);
  });

  test("I1/I8: pedido de mesa recebido não é contado duas vezes (sem receipt: só o recebimento vira venda)", () => {
    const { sales } = contract.run(scenarioMesa());
    expect(sales.byType.MESA.count).toBe(1); // 1 recebimento, não 2 pedidos (M1+M2)
  });

  test("I3 (variante): mesa NÃO recebida ⇒ receita R$130,00, esperado R$140,00 e mesa com receita 0", () => {
    const s = scenarioMesa();
    s.receipts = [];
    s.orders = s.orders.map((o) => (o.receiptId ? { ...o, receiptId: null } : o));
    const { sales, cash } = contract.run(s);
    expect(sales.revenueCents).toBe(13000);
    expect(sales.byType.MESA?.revenueCents ?? 0).toBe(0);
    expect(cash.expectedCents).toBe(14000);
  });

  test("I4: soma dos pagamentos do recebimento diferente do total ⇒ erro (nunca grava recebimento torto)", () => {
    const s = scenarioMesa();
    s.receipts[0].payments[0].amountCents = 6000; // total 6500
    expect(() => contract.run(s)).toThrow();
  });
});

// ───────────────────────── Cenário 2 — especificacao-caixa.md §5 ─────────────────────────
const scenarioCaixa = () => ({
  orders: [
    { id: "P1", type: "BALCAO", status: "CONFIRMADO", totalCents: 4500, paymentMethod: "DINHEIRO", createdAt: at("10:05"), paidAt: at("10:05") }, // já pago (cliente deu 50, troco 5)
    { id: "P2", type: "DELIVERY", status: "CONCLUIDO", totalCents: 3000, paymentMethod: "DINHEIRO", createdAt: at("10:15"), paidAt: at("10:50") }, // pago na entrega, concluído no turno
    { id: "P3", type: "DELIVERY", status: "CONFIRMADO", totalCents: 5000, paymentMethod: "DINHEIRO", createdAt: at("10:20"), paidAt: null }, // ainda não entregue
    { id: "P4", type: "BALCAO", status: "CONCLUIDO", totalCents: 4000, paymentMethod: "PIX", createdAt: at("10:25"), paidAt: at("10:25") },
    { id: "P5", type: "BALCAO", status: "CANCELADO", totalCents: 2000, paymentMethod: "DINHEIRO", createdAt: at("10:30"), paidAt: at("10:30") },
    { id: "P6", type: "BALCAO", status: "PENDENTE", totalCents: 1500, paymentMethod: "DINHEIRO", createdAt: at("10:35"), paidAt: null },
  ],
  movements: [
    { type: "SUPRIMENTO", amountCents: 2000, createdAt: at("10:40") },
    { type: "SANGRIA", amountCents: 5000, createdAt: at("11:00") },
  ],
});

group("QA-05 · cenário 2 (especificacao-caixa §5): esperado R$145,00, a receber R$50,00, diferença −R$2,00", () => {
  test("esperado = 100 + 45 + 30 + 20 − 50 = R$145,00; PIX, cancelado e PENDENTE não entram (I9)", () => {
    const { cash } = contract.run(scenarioCaixa());
    expect(cash.expectedCents).toBe(14500);
    expect(cash.receivedCashCents).toBe(7500);
  });

  test("'dinheiro a receber' informativo = só P3 (R$50,00); P6 PENDENTE não conta (I9)", () => {
    const { cash } = contract.run(scenarioCaixa());
    expect(cash.toReceiveCount).toBe(1);
    expect(cash.toReceiveCents).toBe(5000);
  });

  test("contando R$143,00 a diferença é −R$2,00 (dentro da tolerância de R$5,00)", () => {
    const { cash } = contract.run(scenarioCaixa());
    expect(14300 - cash.expectedCents).toBe(-200);
  });

  test("I10 / CA-CX-14 (teste cruzado): dinheiro do relatório − dinheiro recebido do caixa = 'a receber' (explicável)", () => {
    const { sales, cash } = contract.run(scenarioCaixa());
    // P1 4500 + P2 3000 + P3 5000 = 12500 vendas em dinheiro; recebido 7500; diferença 5000 = P3
    expect(sales.byPaymentMethod.DINHEIRO.revenueCents).toBe(12500);
    expect(sales.byPaymentMethod.DINHEIRO.revenueCents - cash.receivedCashCents).toBe(cash.toReceiveCents);
  });

  test("CA-CX-02: PENDENTE em dinheiro não entra; ao ser aceito e concluído (pago na entrega), entra", () => {
    const s = scenarioCaixa();
    const antes = contract.run(s).cash.expectedCents;
    s.orders = s.orders.map((o) => (o.id === "P6" ? { ...o, status: "CONCLUIDO", paidAt: at("11:30") } : o));
    const depois = contract.run(s).cash.expectedCents;
    expect(depois - antes).toBe(1500);
  });

  test("RN-CX-01: dinheiro recebido ANTES de abrir o caixa ou DEPOIS de fechar não entra na sessão", () => {
    const s = scenarioCaixa();
    s.orders = [
      ...s.orders,
      { id: "X1", type: "BALCAO", status: "CONCLUIDO", totalCents: 9900, paymentMethod: "DINHEIRO", createdAt: at("09:00"), paidAt: at("09:59") },
      { id: "X2", type: "BALCAO", status: "CONCLUIDO", totalCents: 7700, paymentMethod: "DINHEIRO", createdAt: at("12:30"), paidAt: at("12:30") },
    ];
    const r = contract.run({ ...s, session: { openedAt: at("10:00"), closedAt: at("12:00"), openingBalanceCents: 10000 }, now: at("13:00") });
    expect(r.cash.expectedCents).toBe(14500);
  });

  test("RN-CX-14 / I11: DEVOLUCAO no caixa novo reduz o esperado dele em R$45,00 (cancelamento de caixa antigo)", () => {
    const r = contract.run({
      orders: [],
      movements: [{ type: "DEVOLUCAO", amountCents: 4500, createdAt: at("13:10") }],
      session: { openedAt: at("13:00"), closedAt: null, openingBalanceCents: 20000 },
      now: at("14:00"),
    });
    expect(r.cash.refundsCents).toBe(4500);
    expect(r.cash.expectedCents).toBe(15500);
  });

  test("cancelar no MESMO turno tira o pedido do esperado sozinho, sem movimento", () => {
    const s = scenarioCaixa();
    s.orders = s.orders.map((o) => (o.id === "P1" ? { ...o, status: "CANCELADO" } : o));
    const r = contract.run(s);
    expect(r.cash.expectedCents).toBe(14500 - 4500);
    expect(r.cash.refundsCents).toBe(0);
  });
});

// ───────────────────────── Cenário 3 — B14.1 (definição única de venda) ─────────────────────────
group("QA-05 · cenário 3 (B14.1): faturamento R$61,00, gorjeta R$2,00, ticket médio R$30,50", () => {
  const exemplo = () => ({
    orders: [
      { id: "A", type: "DELIVERY", status: "CONFIRMADO", subtotalCents: 4000, discountCents: 400, deliveryFeeCents: 500, tipCents: 200, totalCents: 4300, paymentMethod: "PIX", createdAt: at("19:00") },
      { id: "B", type: "BALCAO", status: "CONCLUIDO", subtotalCents: 2000, totalCents: 2000, paymentMethod: "DINHEIRO", createdAt: at("19:30") },
    ],
  });

  test("CA-B14-01 / I12: faturamento = (43,00 − 2,00) + 20,00 = 61,00; gorjeta 2,00; ticket 30,50; descontos 4,00; taxas 5,00", () => {
    const { sales } = contract.run(exemplo());
    expect(sales.revenueCents).toBe(6100);
    expect(sales.tipCents).toBe(200);
    expect(sales.averageTicketCents).toBe(3050);
    expect(sales.discountCents).toBe(400);
    expect(sales.deliveryFeeCents).toBe(500);
    expect(sales.count).toBe(2);
  });

  test("CA-B14-02: só CONFIRMADO, EM_PREPARO, PRONTO, SAIU_PARA_ENTREGA e CONCLUIDO são venda", () => {
    const statuses = ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"];
    const orders = statuses.map((status, i) => ({ id: `S${i}`, type: "DELIVERY", status, totalCents: 1000, paymentMethod: "PIX", createdAt: at("19:00") }));
    expect(contract.run({ orders }).sales.count).toBe(5);
  });

  test("CA-B14-02: PENDENTE não soma e aparece em 'em aberto'; CANCELADO não soma e aparece em cancelados", () => {
    const { sales } = contract.run({
      orders: [
        { id: "P", type: "BALCAO", status: "PENDENTE", totalCents: 1200, paymentMethod: "DINHEIRO", createdAt: at("19:00") },
        { id: "C", type: "BALCAO", status: "CANCELADO", totalCents: 800, paymentMethod: "DINHEIRO", createdAt: at("19:05") },
      ],
    });
    expect(sales.count).toBe(0);
    expect(sales.revenueCents).toBe(0);
    expect(sales.openCount).toBe(1);
    expect(sales.openCents).toBe(1200);
    expect(sales.canceledCount).toBe(1);
    expect(sales.canceledCents).toBe(800);
  });

  test("aguardando pagamento online (awaitingPayment) nunca é venda, qualquer que seja o status", () => {
    const { sales } = contract.run({
      orders: [{ id: "W", type: "DELIVERY", status: "CONFIRMADO", awaitingPayment: true, totalCents: 5000, paymentMethod: "PIX", createdAt: at("19:00") }],
    });
    expect(sales.count).toBe(0);
  });

  test("CA-B14-03 / I6: pedido às 23:50 no fuso da loja cai no dia local, e o dia seguinte UTC não o puxa", () => {
    const orders = [{ id: "N", type: "BALCAO", status: "CONCLUIDO", totalCents: 3000, paymentMethod: "PIX", createdAt: new Date("2026-11-04T23:50:00-03:00") }];
    const r = contract.run({ orders, range: { from: new Date("2026-11-04T00:00:00-03:00"), to: new Date("2026-11-04T23:59:59.999-03:00") } });
    expect(r.sales.count).toBe(1);
    expect(r.sales.byDay).toEqual([{ date: "2026-11-04", count: 1, revenueCents: 3000 }]);
    const dia5 = contract.run({ orders, range: { from: new Date("2026-11-05T00:00:00-03:00"), to: new Date("2026-11-05T23:59:59.999-03:00") } });
    expect(dia5.sales.count).toBe(0);
  });

  test("CA-B14-09 / D18: período de UM dia não inclui o pedido da noite do dia anterior (21:30 local = 00:30Z do dia seguinte)", () => {
    const orders = [
      { id: "ontem", type: "BALCAO", status: "CONCLUIDO", totalCents: 1000, paymentMethod: "PIX", createdAt: new Date("2026-11-10T21:30:00-03:00") },
      { id: "hoje", type: "BALCAO", status: "CONCLUIDO", totalCents: 2000, paymentMethod: "PIX", createdAt: new Date("2026-11-11T23:30:00-03:00") },
    ];
    const r = contract.run({ orders, range: { from: new Date("2026-11-11T00:00:00-03:00"), to: new Date("2026-11-11T23:59:59.999-03:00") } });
    expect(r.sales.byDay).toEqual([{ date: "2026-11-11", count: 1, revenueCents: 2000 }]);
  });
});

// ───────────────────────── Pendências de decisão / de camada superior ─────────────────────────
group("QA-05 · casos que dependem da API/banco (viram teste de integração em API-21/API-27)", () => {
  it.todo("I7: o resumo de caixa FECHADO vem do summarySnapshot e não muda quando pedidos do turno são cancelados depois");
  it.todo("I8: cancelar pedido de mesa já recebido ⇒ 409 ORDER_ALREADY_RECEIVED");
  it.todo("CA-MB-04: receber a mesa em dinheiro sem caixa aberto ⇒ 409 CASH_REQUIRED");
  it.todo("RN-CX-14: cancelar pedido em dinheiro de caixa já fechado cria DEVOLUCAO no caixa atual (idempotente: Order.cashRefundMovementId único); sem caixa aberto ⇒ 409 CASH_REQUIRED");
  it.todo("RN-CX-18 / CA-CX-09: dois fechamentos simultâneos ⇒ 1 fechamento e 1 × 409 CASH_ALREADY_CLOSED (sonda D29 em qa-caixa.test.ts)");
  it.todo("CA-CX-05: sangria maior que o dinheiro em caixa ⇒ 409 CASH_WITHDRAWAL_EXCEEDS_BALANCE; igual ao saldo é aceita (sonda D28)");
  it.todo("CA-CX-07: STAFF com limite de sangria 0 ⇒ 403; com limite R$100,00, R$100,00 passa e R$100,01 não");
  it.todo("PRO: taxa de serviço do recebimento distribuída proporcionalmente entre as formas de pagamento, soma exata (maior resto)");
  it.todo("CA-B14-04: receita do produto inclui as opções (R$8,00 × 2 = R$16,00)");
  it.todo("CA-B14-09 / CA-CX-15: nenhum relatório/caixa inclui dados de outra loja (matriz por rota, QA-03)");
});
