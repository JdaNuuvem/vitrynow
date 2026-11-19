import { Prisma, prisma } from "@meucardapio/db";
import { SALE_STATUSES } from "./saleLines";
import { utc } from "./sqlTime";

// API-20 (B14): relatórios agregados NO BANCO, no fuso da loja, com a definição única de venda (API-21, lib/saleLines):
// venda = CONFIRMADO..CONCLUIDO e fora de "aguardando pagamento"; faturamento = total - gorjeta; PENDENTE = "em aberto"; CANCELADO à parte.
// Nada de carregar pedidos na memória: o período máximo (366 dias) agrega no Postgres.

import { MAX_REPORT_DAYS, DEFAULT_REPORT_DAYS, resolveReportPeriod, type ReportPeriod, type RangeError } from "./reportPeriod";

// O período vive em lib/reportPeriod.ts (UMA função, fuso da loja). Aqui só os apelidos que o resto do código já importa.
export { MAX_REPORT_DAYS, DEFAULT_REPORT_DAYS };
export type ReportRange = ReportPeriod;
export type { RangeError };
export const resolveRange = (query: { preset?: string; from?: string; to?: string }, now: Date = new Date(), timeZone?: string | null): ReportRange | { error: RangeError } => resolveReportPeriod(query, now, timeZone);

export type Bucket = { count: number; revenueCents: number };
export type Report = {
  from: string;
  to: string;
  fromDate: string;
  toDate: string;
  timeZone: string;
  partial: boolean;
  orderCount: number;
  revenueCents: number;
  discountCents: number;
  averageTicketCents: number;
  customerCount: number;
  deliveryFeeCents: number;
  tipCents: number;
  byPaymentMethod: Record<string, Bucket>;
  byDay: { date: string; orderCount: number; revenueCents: number }[];
  byType: Record<string, Bucket>;
  // Produto por PESO (PD, RN-PD-22): `quantity` conta PEDIDOS (1 por linha, nunca gramas como unidades) e `weightGrams` soma o peso vendido (kg = gramas ÷ 1.000, 3 casas no CSV).
  topProducts: { productName: string; quantity: number; revenueCents: number; weightGrams: number }[];
  byDeliverer: { delivererName: string; orderCount: number; revenueCents: number }[];
  cashSummary: { sessionCount: number; suprimentosCents: number; sangriasCents: number };
  canceledCount: number;
  canceledCents: number;
  openCount: number;
  openCents: number;
};

const n = (value: bigint | number | null | undefined) => Number(value ?? 0);

export async function buildReport(storeId: string, range: ReportRange): Promise<Report> {
  const sale = Prisma.sql`o."status"::text = ANY(${[...SALE_STATUSES]}) AND o."type"::text <> 'MESA'`; // API-24: a venda da mesa é o RECEBIMENTO, não o pedido
  // Janela por instante (UTC) das 00:00 locais; o agrupamento por dia converte para o fuso da loja DENTRO do banco.
  const window = Prisma.sql`o."storeId" = ${storeId} AND o."awaitingPayment" = false AND o."createdAt" >= ${utc(range.fromUtc)} AND o."createdAt" < ${utc(range.toExclusiveUtc)}`;
  const localDay = Prisma.sql`to_char((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone}, 'YYYY-MM-DD')`;

  const rWindow = Prisma.sql`r."storeId" = ${storeId} AND r."receivedAt" >= ${utc(range.fromUtc)} AND r."receivedAt" < ${utc(range.toExclusiveUtc)}`;
  const rDay = Prisma.sql`to_char((r."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone}, 'YYYY-MM-DD')`;

  const [totals, days, payments, types, products, deliverers, cash, rTotal, rDays, rPayments, rProducts] = await Promise.all([
    prisma.$queryRaw<
      {
        saleCount: bigint; revenue: bigint; discount: bigint; fee: bigint; tip: bigint; customers: bigint;
        canceledCount: bigint; canceledCents: bigint; openCount: bigint; openCents: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        count(*) FILTER (WHERE ${sale}) AS "saleCount",
        coalesce(sum(o."totalCents" - o."tipCents") FILTER (WHERE ${sale}), 0)::bigint AS "revenue",
        coalesce(sum(o."discountCents") FILTER (WHERE ${sale}), 0)::bigint AS "discount",
        coalesce(sum(o."deliveryFeeCents") FILTER (WHERE ${sale}), 0)::bigint AS "fee",
        coalesce(sum(o."tipCents") FILTER (WHERE ${sale}), 0)::bigint AS "tip",
        count(DISTINCT nullif(coalesce(o."customerPhone", o."customerName"), '')) FILTER (WHERE ${sale}) AS "customers",
        count(*) FILTER (WHERE o."status" = 'CANCELADO') AS "canceledCount",
        coalesce(sum(o."totalCents") FILTER (WHERE o."status" = 'CANCELADO'), 0)::bigint AS "canceledCents",
        count(*) FILTER (WHERE o."status" = 'PENDENTE' AND o."type"::text <> 'MESA') AS "openCount",
        coalesce(sum(o."totalCents") FILTER (WHERE o."status" = 'PENDENTE' AND o."type"::text <> 'MESA'), 0)::bigint AS "openCents"
      FROM "Order" o WHERE ${window}`),
    prisma.$queryRaw<{ date: string; count: bigint; revenue: bigint }[]>(Prisma.sql`
      SELECT ${localDay} AS "date", count(*) AS "count", sum(o."totalCents" - o."tipCents")::bigint AS "revenue"
      FROM "Order" o WHERE ${window} AND ${sale} GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ bucket: string; count: bigint; revenue: bigint }[]>(Prisma.sql`
      SELECT CASE WHEN o."totalCents" = 0 THEN 'SEM_COBRANCA' ELSE coalesce(o."paymentMethod"::text, 'NAO_IDENTIFICADO') END AS "bucket",
             count(*) AS "count", sum(o."totalCents" - o."tipCents")::bigint AS "revenue"
      FROM "Order" o WHERE ${window} AND ${sale} GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ bucket: string; count: bigint; revenue: bigint }[]>(Prisma.sql`
      SELECT o."type"::text AS "bucket", count(*) AS "count", sum(o."totalCents" - o."tipCents")::bigint AS "revenue"
      FROM "Order" o WHERE ${window} AND ${sale} GROUP BY 1 ORDER BY 1`),
    // Receita do produto INCLUI as opções (CA-B14-04): (preço unitário + soma das opções da linha) x quantidade.
    prisma.$queryRaw<{ key: string; name: string; quantity: bigint; revenue: bigint; grams: bigint }[]>(Prisma.sql`
      SELECT coalesce(i."productId", i."productName") AS "key", max(i."productName") AS "name", sum(i."quantity") AS "quantity",
             sum((i."unitPriceCents" + coalesce(a."extra", 0)) * i."quantity")::bigint AS "revenue", coalesce(sum(i."weightGrams"), 0)::bigint AS "grams"
      FROM "OrderItem" i
      JOIN "Order" o ON o."id" = i."orderId"
      LEFT JOIN LATERAL (SELECT sum(x."priceCents") AS "extra" FROM "OrderItemAdditional" x WHERE x."orderItemId" = i."id") a ON true
      WHERE ${window} AND ${sale}
      GROUP BY 1`), // o top 10 sai depois de juntar com os produtos das mesas
    prisma.$queryRaw<{ name: string; count: bigint; revenue: bigint }[]>(Prisma.sql`
      SELECT d."name" AS "name", count(*) AS "count", sum(o."totalCents")::bigint AS "revenue"
      FROM "Order" o JOIN "Deliverer" d ON d."id" = o."delivererId"
      WHERE ${window} AND ${sale}
      GROUP BY d."id", d."name" ORDER BY count(*) DESC, d."name" ASC`),
    prisma.$queryRaw<{ sessions: bigint; suprimentos: bigint; sangrias: bigint }[]>(Prisma.sql`
      SELECT count(DISTINCT s."id") AS "sessions",
             coalesce(sum(m."amountCents") FILTER (WHERE m."type" = 'SUPRIMENTO'), 0)::bigint AS "suprimentos",
             coalesce(sum(m."amountCents") FILTER (WHERE m."type" = 'SANGRIA'), 0)::bigint AS "sangrias"
      FROM "CashSession" s LEFT JOIN "CashMovement" m ON m."cashSessionId" = s."id"
      WHERE s."storeId" = ${storeId} AND s."openedAt" >= ${utc(range.fromUtc)} AND s."openedAt" < ${utc(range.toExclusiveUtc)}`),
    // API-24 (RN-MB-04): cada recebimento de mesa é UMA venda, reconhecida em receivedAt.
    prisma.$queryRaw<{ count: bigint; revenue: bigint }[]>(Prisma.sql`SELECT count(*) AS "count", coalesce(sum(r."totalCents"), 0)::bigint AS "revenue" FROM "Receipt" r WHERE ${rWindow}`),
    prisma.$queryRaw<{ date: string; count: bigint; revenue: bigint }[]>(Prisma.sql`SELECT ${rDay} AS "date", count(*) AS "count", sum(r."totalCents")::bigint AS "revenue" FROM "Receipt" r WHERE ${rWindow} GROUP BY 1`),
    prisma.$queryRaw<{ bucket: string; count: bigint; revenue: bigint }[]>(Prisma.sql`SELECT p."method"::text AS "bucket", count(*) AS "count", sum(p."amountCents")::bigint AS "revenue" FROM "ReceiptPayment" p JOIN "Receipt" r ON r."id" = p."receiptId" WHERE ${rWindow} GROUP BY 1`),
    prisma.$queryRaw<{ key: string; name: string; quantity: bigint; revenue: bigint; grams: bigint }[]>(Prisma.sql`
      SELECT coalesce(i."productId", i."productName") AS "key", max(i."productName") AS "name", sum(i."quantity") AS "quantity",
             sum((i."unitPriceCents" + coalesce(a."extra", 0)) * i."quantity")::bigint AS "revenue", coalesce(sum(i."weightGrams"), 0)::bigint AS "grams"
      FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId" JOIN "Receipt" r ON r."id" = o."receiptId"
      LEFT JOIN LATERAL (SELECT sum(x."priceCents") AS "extra" FROM "OrderItemAdditional" x WHERE x."orderItemId" = i."id") a ON true
      WHERE ${rWindow} AND o."status" <> 'CANCELADO' GROUP BY 1`),
  ]);

  const t = totals[0];
  const receipts = { count: n(rTotal[0].count), revenue: n(rTotal[0].revenue) };
  const orderCount = n(t.saleCount) + receipts.count;
  const revenueCents = n(t.revenue) + receipts.revenue;
  // pedidos + recebimentos de mesa
  const mergeBuckets = (base: Record<string, Bucket>, extra: { bucket: string; count: bigint; revenue: bigint }[]) => {
    for (const r of extra) {
      base[r.bucket] ??= { count: 0, revenueCents: 0 };
      base[r.bucket].count += n(r.count);
      base[r.bucket].revenueCents += n(r.revenue);
    }
    return base;
  };
  const dayMap = new Map(days.map((r) => [r.date, { date: r.date, orderCount: n(r.count), revenueCents: n(r.revenue) }]));
  for (const r of rDays) {
    const e = dayMap.get(r.date) ?? { date: r.date, orderCount: 0, revenueCents: 0 };
    e.orderCount += n(r.count);
    e.revenueCents += n(r.revenue);
    dayMap.set(r.date, e);
  }
  const productMap = new Map<string, { productName: string; quantity: number; revenueCents: number; weightGrams: number }>();
  for (const r of [...products, ...rProducts]) {
    const e = productMap.get(r.key) ?? { productName: r.name, quantity: 0, revenueCents: 0, weightGrams: 0 };
    e.quantity += n(r.quantity);
    e.revenueCents += n(r.revenue);
    e.weightGrams += n(r.grams);
    productMap.set(r.key, e);
  }
  const toBuckets = (rows: { bucket: string; count: bigint; revenue: bigint }[]) =>
    Object.fromEntries(rows.map((r) => [r.bucket, { count: n(r.count), revenueCents: n(r.revenue) }])) as Record<string, Bucket>;
  return {
    from: range.fromUtc.toISOString(),
    to: range.toExclusiveUtc.toISOString(),
    fromDate: range.fromDate,
    toDate: range.toDate,
    timeZone: range.timeZone,
    partial: range.partial,
    orderCount,
    revenueCents,
    discountCents: n(t.discount),
    averageTicketCents: orderCount > 0 ? Math.round(revenueCents / orderCount) : 0,
    customerCount: n(t.customers),
    deliveryFeeCents: n(t.fee),
    tipCents: n(t.tip),
    byPaymentMethod: mergeBuckets(toBuckets(payments), rPayments),
    byDay: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byType: receipts.count > 0 ? { ...toBuckets(types), MESA: { count: receipts.count, revenueCents: receipts.revenue } } : toBuckets(types),
    topProducts: [...productMap.values()].sort((a, b) => b.quantity - a.quantity || a.productName.localeCompare(b.productName)).slice(0, 10),
    byDeliverer: deliverers.map((r) => ({ delivererName: r.name, orderCount: n(r.count), revenueCents: n(r.revenue) })),
    cashSummary: { sessionCount: n(cash[0].sessions), suprimentosCents: n(cash[0].suprimentos), sangriasCents: n(cash[0].sangrias) },
    canceledCount: n(t.canceledCount),
    canceledCents: n(t.canceledCents),
    openCount: n(t.openCount),
    openCents: n(t.openCents),
  };
}

// ---- CSV (B14.2): abre no Excel brasileiro: separador ";", vírgula decimal, UTF-8 com BOM, quebra CRLF ----

export const CSV_TABLES = ["summary", "byDay", "byPaymentMethod", "byType", "topProducts", "byDeliverer"] as const;
export type CsvTable = (typeof CSV_TABLES)[number];

// Peso vendido em kg com 3 casas e vírgula decimal (1250 g => "1,250"); vazio quando o produto não é vendido por peso.
export const kgText = (grams: number) => (grams > 0 ? `${Math.floor(grams / 1000)},${String(grams % 1000).padStart(3, "0")}` : "");

export const reais = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, "0")}`;

// Texto que o Excel leria como fórmula (= + - @ ou tab/CR no início) ganha um apóstrofo: nome de produto/entregador vem de gente (injeção em CSV).
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const PAYMENT_LABEL: Record<string, string> = { DINHEIRO: "Dinheiro", PIX: "PIX", CREDITO: "Crédito", DEBITO: "Débito", VR: "VR", VA: "VA", SEM_COBRANCA: "Sem cobrança", NAO_IDENTIFICADO: "Não identificado" };
const TYPE_LABEL: Record<string, string> = { DELIVERY: "Entrega", BALCAO: "Retirada", MESA: "Mesa" };

export function reportRows(report: Report, table: CsvTable): (string | number)[][] {
  switch (table) {
    case "summary":
      return [
        ["Indicador", "Valor"],
        ["Período", `${report.fromDate} a ${report.toDate}`],
        ["Vendas", report.orderCount],
        ["Faturamento (R$)", reais(report.revenueCents)],
        ["Ticket médio (R$)", reais(report.averageTicketCents)],
        ["Descontos (R$)", reais(report.discountCents)],
        ["Taxas de entrega (R$)", reais(report.deliveryFeeCents)],
        ["Gorjetas (R$)", reais(report.tipCents)],
        ["Clientes", report.customerCount],
        ["Cancelados (qtd)", report.canceledCount],
        ["Cancelados (R$)", reais(report.canceledCents)],
        ["Aguardando aceite (qtd)", report.openCount],
        ["Aguardando aceite (R$)", reais(report.openCents)],
        ["Caixas abertos no período", report.cashSummary.sessionCount],
        ["Suprimentos (R$)", reais(report.cashSummary.suprimentosCents)],
        ["Sangrias (R$)", reais(report.cashSummary.sangriasCents)],
      ];
    case "byDay":
      return [["Data", "Vendas", "Faturamento (R$)"], ...report.byDay.map((r) => [r.date, r.orderCount, reais(r.revenueCents)])];
    case "byPaymentMethod":
      return [["Forma de pagamento", "Vendas", "Faturamento (R$)"], ...Object.entries(report.byPaymentMethod).map(([k, v]) => [PAYMENT_LABEL[k] ?? k, v.count, reais(v.revenueCents)])];
    case "byType":
      return [["Tipo", "Vendas", "Faturamento (R$)"], ...Object.entries(report.byType).map(([k, v]) => [TYPE_LABEL[k] ?? k, v.count, reais(v.revenueCents)])];
    case "topProducts":
      return [["Produto", "Quantidade", "Receita com opções (R$)", "Peso vendido (kg)"], ...report.topProducts.map((r) => [r.productName, r.quantity, reais(r.revenueCents), kgText(r.weightGrams)])];
    case "byDeliverer":
      return [["Entregador", "Entregas", "Valor dos pedidos (R$)"], ...report.byDeliverer.map((r) => [r.delivererName, r.orderCount, reais(r.revenueCents)])];
  }
}

const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);
export const toCsv = (rows: (string | number)[][]): string => `${BOM}${rows.map((row) => row.map(csvCell).join(";")).join(CRLF)}${CRLF}`;