// API-20 (B14): relatórios agregados em SQL no fuso da loja + CSV. CA-B14-01..07 (a parte de API).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { csvCell, reais, resolveRange, toCsv } from "../src/lib/reports";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("regras puras do período e do CSV", () => {
  const now = new Date("2026-11-18T15:00:00Z"); // 12:00 em São Paulo

  it("datas AAAA-MM-DD são do dia da loja e inclusivas; padrão = 30 dias terminando hoje", () => {
    const r = resolveRange({ from: "2026-11-04", to: "2026-11-04" }, now) as { fromUtc: Date; toExclusiveUtc: Date };
    expect(r.fromUtc.toISOString()).toBe("2026-11-04T03:00:00.000Z"); // 00:00 em São Paulo
    expect(r.toExclusiveUtc.toISOString()).toBe("2026-11-05T03:00:00.000Z");
    const d = resolveRange({}, now) as { fromDate: string; toDate: string };
    expect([d.fromDate, d.toDate]).toEqual(["2026-10-20", "2026-11-18"]);
  });
  it("hoje é o dia da LOJA, não o do servidor: 01:00Z do dia 19 ainda é dia 18 em São Paulo", () => {
    const r = resolveRange({}, new Date("2026-11-19T01:00:00Z")) as { toDate: string };
    expect(r.toDate).toBe("2026-11-18");
  });
  it("instante ISO (formato antigo) vira o dia da loja desse instante", () => {
    const r = resolveRange({ from: "2026-11-05T02:50:00Z", to: "2026-11-05T02:50:00Z" }, now) as { fromDate: string };
    expect(r.fromDate).toBe("2026-11-04");
  });
  it("recusa data inexistente, início depois do fim e período acima de 366 dias; 366 ainda vale", () => {
    expect(resolveRange({ from: "2026-02-30", to: "2026-03-01" }, now)).toEqual({ error: "INVALID_DATE" });
    expect(resolveRange({ from: "lixo" }, now)).toEqual({ error: "INVALID_DATE" });
    expect(resolveRange({ from: "2026-11-10", to: "2026-11-09" }, now)).toEqual({ error: "FROM_AFTER_TO" });
    expect(resolveRange({ from: "2025-11-17", to: "2026-11-18" }, now)).toEqual({ error: "PERIOD_TOO_LONG" }); // 367 dias
    expect("error" in (resolveRange({ from: "2025-11-18", to: "2026-11-18" }, now) as object)).toBe(false); // 366: o máximo vale
      });
  it("valores em reais com vírgula; célula com ponto e vírgula/aspas é protegida; fórmula ganha apóstrofo (CA-B14-07)", () => {
    expect(reais(6100)).toBe("61,00");
    expect(reais(5)).toBe("0,05");
    expect(reais(0)).toBe("0,00");
    expect(csvCell("Café; com leite")).toBe('"Café; com leite"');
    expect(csvCell('Pizza "G"')).toBe('"Pizza ""G"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+55")).toBe("'+55");
    const csv = toCsv([["Produto", "Receita (R$)"], ["Açaí", "10,50"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(["Produto;Receita (R$)", "Açaí;10,50", ""].join(String.fromCharCode(13, 10)));
  });
});

describe("relatórios (rotas)", () => {
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

  let seq = 0;
  async function setup(slug: string, code: string) {
    const r = await registerStore(app, { slug, code });
    const store = await prisma.store.findUniqueOrThrow({ where: { slug } });
    return { cookie: r.cookie!, storeId: store.id };
  }
  type Seed = {
    status?: "PENDENTE" | "CONFIRMADO" | "EM_PREPARO" | "PRONTO" | "SAIU_PARA_ENTREGA" | "CONCLUIDO" | "CANCELADO";
    type?: "DELIVERY" | "BALCAO" | "MESA";
    subtotal: number;
    discount?: number;
    fee?: number;
    tip?: number;
    createdAt: string;
    awaitingPayment?: boolean;
    paymentMethod?: "DINHEIRO" | "PIX" | null;
    phone?: string | null;
    name?: string | null;
    delivererId?: string;
    items?: { name: string; productId?: string; qty: number; unit: number; extras?: number[] }[];
  };
  async function seed(storeId: string, o: Seed) {
    seq += 1;
    const total = o.subtotal - (o.discount ?? 0) + (o.fee ?? 0) + (o.tip ?? 0);
    return prisma.order.create({
      data: {
        storeId, code: `S${seq}`, type: o.type ?? "BALCAO", status: o.status ?? "CONCLUIDO", awaitingPayment: o.awaitingPayment ?? false,
        subtotalCents: o.subtotal, discountCents: o.discount ?? 0, deliveryFeeCents: o.fee ?? 0, tipCents: o.tip ?? 0, totalCents: total,
        paymentMethod: o.paymentMethod === undefined ? "DINHEIRO" : o.paymentMethod, createdAt: new Date(o.createdAt),
        customerPhone: o.phone === undefined ? `1199999${String(seq).padStart(4, "0")}` : o.phone, customerName: o.name ?? null, delivererId: o.delivererId,
        items: { create: (o.items ?? []).map((i) => ({ productId: i.productId, productName: i.name, quantity: i.qty, unitPriceCents: i.unit, additionals: { create: (i.extras ?? []).map((p) => ({ name: "Extra", priceCents: p })) } })) },
      },
    });
  }
  const summary = async (cookie: string, qs: string) => json(await app.inject({ method: "GET", url: `/api/reports/summary?${qs}`, headers: { cookie } }));
  // STAFF criado direto no banco (o convite pela API depende do plano; aqui só importa o papel). Reusa a senha do dono da loja.
  const staffCookie = async (storeId: string) => {
    const owner = await prisma.user.findFirstOrThrow({ where: { storeId, role: "OWNER" } });
    const email = `staff-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await prisma.user.create({ data: { storeId, email, passwordHash: owner.passwordHash, role: "STAFF" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "senha12345" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  };

  it("CA-B14-01: o exemplo fechado — faturamento 61,00, gorjeta 2,00, ticket médio 30,50, descontos 4,00, taxas 5,00", async () => {
    const { cookie, storeId } = await setup("rel-a", "RA1");
    await seed(storeId, { type: "DELIVERY", subtotal: 4000, discount: 400, fee: 500, tip: 200, createdAt: "2026-11-10T15:00:00Z", paymentMethod: "PIX" });
    await seed(storeId, { subtotal: 2000, createdAt: "2026-11-10T16:00:00Z" });
    const r = await summary(cookie, "from=2026-11-10&to=2026-11-10");
    expect([r.orderCount, r.revenueCents, r.tipCents, r.averageTicketCents, r.discountCents, r.deliveryFeeCents]).toEqual([2, 6100, 200, 3050, 400, 500]);
    expect(r.byPaymentMethod).toEqual({ PIX: { count: 1, revenueCents: 4100 }, DINHEIRO: { count: 1, revenueCents: 2000 } });
    expect(r.byType).toEqual({ DELIVERY: { count: 1, revenueCents: 4100 }, BALCAO: { count: 1, revenueCents: 2000 } });
  });

  it("CA-B14-02/06: PENDENTE não é venda (vai em 'aguardando aceite'); CANCELADO à parte com valor; aguardando pagamento fica de fora de tudo", async () => {
    const { cookie, storeId } = await setup("rel-b", "RB1");
    await seed(storeId, { subtotal: 3000, createdAt: "2026-11-10T15:00:00Z" });
    await seed(storeId, { status: "PENDENTE", subtotal: 1500, createdAt: "2026-11-10T15:10:00Z" });
    await seed(storeId, { status: "CANCELADO", subtotal: 2500, createdAt: "2026-11-10T15:20:00Z" });
    await seed(storeId, { status: "CONFIRMADO", subtotal: 9900, awaitingPayment: true, createdAt: "2026-11-10T15:30:00Z" });
    const r = await summary(cookie, "from=2026-11-10&to=2026-11-10");
    expect([r.orderCount, r.revenueCents]).toEqual([1, 3000]);
    expect([r.openCount, r.openCents, r.canceledCount, r.canceledCents]).toEqual([1, 1500, 1, 2500]);
  });

  it("CA-B14-03: pedido às 23:50 da loja no dia 04 entra no dia 04, não no 05 (UTC); 00:10 do dia 05 já é o dia 05", async () => {
    const { cookie, storeId } = await setup("rel-c", "RC1");
    await seed(storeId, { subtotal: 1000, createdAt: "2026-11-05T02:50:00Z" }); // 23:50 de 04/11 em São Paulo
    await seed(storeId, { subtotal: 2000, createdAt: "2026-11-05T03:10:00Z" }); // 00:10 de 05/11
    const day4 = await summary(cookie, "from=2026-11-04&to=2026-11-04");
    expect([day4.orderCount, day4.revenueCents]).toEqual([1, 1000]);
    const both = await summary(cookie, "from=2026-11-04&to=2026-11-05");
    expect(both.byDay).toEqual([{ date: "2026-11-04", orderCount: 1, revenueCents: 1000 }, { date: "2026-11-05", orderCount: 1, revenueCents: 2000 }]);
  });

  it("CA-B14-04: receita do produto inclui as opções (2 vendidos com opção de R$ 8,00 = + R$ 16,00); top 10 por quantidade", async () => {
    const { cookie, storeId } = await setup("rel-d", "RD1");
    await seed(storeId, { subtotal: 5600, createdAt: "2026-11-10T15:00:00Z", items: [{ name: "X-Burger", qty: 2, unit: 1500, extras: [800] }] });
    await seed(storeId, { subtotal: 1500, createdAt: "2026-11-10T16:00:00Z", items: [{ name: "X-Burger", qty: 1, unit: 1500 }, { name: "Suco", qty: 5, unit: 400 }] });
    const r = await summary(cookie, "from=2026-11-10&to=2026-11-10");
    const burger = r.topProducts.find((p: { productName: string }) => p.productName === "X-Burger");
    expect(burger).toEqual({ productName: "X-Burger", quantity: 3, revenueCents: 3 * 1500 + 2 * 800 });
    expect(r.topProducts[0].productName).toBe("Suco"); // 5 > 3 por quantidade
    for (let i = 0; i < 12; i++) await seed(storeId, { subtotal: 100, createdAt: "2026-11-10T17:00:00Z", items: [{ name: `P${String(i).padStart(2, "0")}`, qty: 1, unit: 100 }] });
    expect((await summary(cookie, "from=2026-11-10&to=2026-11-10")).topProducts).toHaveLength(10);
  });

  it("CA-B14-05: as tabelas fecham com o total (por dia, forma de pagamento e tipo somam o faturamento); clientes = telefones distintos (ou nome sem telefone)", async () => {
    const { cookie, storeId } = await setup("rel-e", "RE1");
    await seed(storeId, { subtotal: 1000, createdAt: "2026-11-10T15:00:00Z", phone: "11111" });
    await seed(storeId, { subtotal: 2000, createdAt: "2026-11-11T15:00:00Z", phone: "11111", paymentMethod: "PIX" });
    await seed(storeId, { subtotal: 3000, createdAt: "2026-11-11T16:00:00Z", phone: null, name: "Ana", paymentMethod: null, type: "MESA" });
    await seed(storeId, { subtotal: 4000, createdAt: "2026-11-11T17:00:00Z", phone: null, name: null, paymentMethod: "DINHEIRO" });
    await seed(storeId, { subtotal: 5000, tip: 500, discount: 5000, createdAt: "2026-11-11T18:00:00Z", paymentMethod: "PIX" }); // total só gorjeta... desconto cobre tudo
    const r = await summary(cookie, "from=2026-11-10&to=2026-11-11");
    const sum = (rows: { revenueCents: number }[]) => rows.reduce((s, x) => s + x.revenueCents, 0);
    expect(sum(r.byDay)).toBe(r.revenueCents);
    expect(sum(Object.values(r.byPaymentMethod))).toBe(r.revenueCents);
    expect(sum(Object.values(r.byType))).toBe(r.revenueCents);
    expect(r.customerCount).toBe(3); // 11111 (2 pedidos), Ana (sem telefone) e o telefone gerado do último; sem telefone e sem nome não conta
    expect(r.byPaymentMethod.NAO_IDENTIFICADO).toEqual({ count: 1, revenueCents: 3000 });
  });

  it("entregador: pedidos e valor por entregador; só vendas", async () => {
    const { cookie, storeId } = await setup("rel-f", "RF1");
    const d = await prisma.deliverer.create({ data: { storeId, name: "Zé" } });
    await seed(storeId, { type: "DELIVERY", subtotal: 2000, fee: 500, createdAt: "2026-11-10T15:00:00Z", delivererId: d.id });
    await seed(storeId, { type: "DELIVERY", status: "CANCELADO", subtotal: 9000, createdAt: "2026-11-10T16:00:00Z", delivererId: d.id });
    const r = await summary(cookie, "from=2026-11-10&to=2026-11-10");
    expect(r.byDeliverer).toEqual([{ delivererName: "Zé", orderCount: 1, revenueCents: 2500 }]);
  });

  it("caixa: sessões abertas no período, suprimentos e sangrias", async () => {
    const { cookie, storeId } = await setup("rel-g", "RG1");
    const user = await prisma.user.findFirstOrThrow({ where: { storeId } });
    const s = await prisma.cashSession.create({ data: { storeId, openedByUserId: user.id, openedAt: new Date("2026-11-10T12:00:00Z") } });
    await prisma.cashMovement.createMany({ data: [{ cashSessionId: s.id, type: "SUPRIMENTO", amountCents: 5000 }, { cashSessionId: s.id, type: "SANGRIA", amountCents: 1200 }] });
    const r = await summary(cookie, "from=2026-11-10&to=2026-11-10");
    expect(r.cashSummary).toEqual({ sessionCount: 1, suprimentosCents: 5000, sangriasCents: 1200 });
    expect((await summary(cookie, "from=2026-11-11&to=2026-11-11")).cashSummary.sessionCount).toBe(0);
  });

  it("período: datas inválidas, invertidas ou acima de 366 dias => 400 com código; sem parâmetros traz os últimos 30 dias", async () => {
    const { cookie, storeId } = await setup("rel-h", "RH1");
    const get = (qs: string) => app.inject({ method: "GET", url: `/api/reports/summary?${qs}`, headers: { cookie } });
    expect((await get("from=2026-13-01&to=2026-13-02")).statusCode).toBe(400);
    expect(json(await get("from=2026-11-10&to=2026-11-01")).code).toBe("REPORT_RANGE_INVALID");
    const long = await get("from=2024-01-01&to=2026-11-01");
    expect([long.statusCode, json(long).code]).toEqual([400, "REPORT_WINDOW_TOO_LARGE"]);
    await seed(storeId, { subtotal: 1000, createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString() });
    await seed(storeId, { subtotal: 1000, createdAt: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString() });
    const def = json(await get(""));
    expect(def.orderCount).toBe(1);
    expect(def.timeZone).toBe("America/Sao_Paulo");
    expect((await app.inject({ method: "GET", url: "/api/reports/summary" })).statusCode).toBe(401);
  });

  it("isolamento: a loja B não enxerga vendas da loja A", async () => {
    const a = await setup("rel-i", "RI1");
    const b = await setup("rel-j", "RJ1");
    await seed(a.storeId, { subtotal: 7000, createdAt: "2026-11-10T15:00:00Z", items: [{ name: "Só da A", qty: 1, unit: 7000 }] });
    const r = await summary(b.cookie, "from=2026-11-10&to=2026-11-10");
    expect([r.orderCount, r.revenueCents, r.topProducts.length]).toEqual([0, 0, 0]);
  });

  it("CSV: só o OWNER baixa (STAFF 403, sem login 401); BOM, ';', vírgula decimal, acentos e CRLF; fórmula neutralizada; tabela inválida 400; exportação auditada", async () => {
    const { cookie, storeId } = await setup("rel-k", "RK1");
    await seed(storeId, { subtotal: 4000, discount: 400, createdAt: "2026-11-10T15:00:00Z", items: [{ name: "=Açaí; \"G\"", qty: 2, unit: 1500, extras: [800] }] });
    const url = (qs: string) => `/api/reports/export.csv?from=2026-11-10&to=2026-11-10&${qs}`;
    const staff = await staffCookie(storeId);
    expect((await app.inject({ method: "GET", url: url("table=summary"), headers: { cookie: staff } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: url("table=summary") })).statusCode).toBe(401);
    const bad = await app.inject({ method: "GET", url: url("table=outra"), headers: { cookie } });
    expect([bad.statusCode, json(bad).code]).toEqual([400, "INVALID_TABLE"]);

    const res = await app.inject({ method: "GET", url: url("table=topProducts"), headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("relatorio-topProducts-2026-11-10-a-2026-11-10.csv");
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    const lines = res.body.slice(1).split(String.fromCharCode(13, 10));
    expect(lines[0]).toBe("Produto;Quantidade;Receita com opções (R$)");
    expect(lines[1]).toBe(`"'=Açaí; ""G""";2;46,00`); // 2 x (15,00 + 8,00)

    const summaryCsv = (await app.inject({ method: "GET", url: url("table=summary"), headers: { cookie } })).body;
    expect(summaryCsv).toContain("Faturamento (R$);36,00");
    expect(summaryCsv).toContain("Descontos (R$);4,00");
    for (const table of ["byDay", "byPaymentMethod", "byType", "byDeliverer"]) {
      expect((await app.inject({ method: "GET", url: url(`table=${table}`), headers: { cookie } })).statusCode).toBe(200);
    }
    let audits = 0;
    for (let i = 0; i < 30 && audits < 6; i++) {
      await new Promise((r) => setTimeout(r, 100));
      audits = await prisma.auditLog.count({ where: { storeId, action: "report.export" } });
    }
    expect(audits).toBe(6);
  });
});
