import { Prisma, prisma } from "@meucardapio/db";
import { buildReport, type ReportRange } from "./reports";
import { SALE_STATUSES } from "./saleLines";
import { utc } from "./sqlTime";

// API-45 (PRO) — relatórios avançados. Mesma DEFINIÇÃO DE VENDA dos relatórios (API-21): pedido em status de venda, fora de MESA, não
// aguardando pagamento, no `createdAt`; mesa = o RECEBIMENTO, no `receivedAt`. Receita do pedido = total - gorjeta; da mesa = total.
// Tudo no fuso da loja e agregado no banco. Nada de dado pessoal: clientes só em CONTAGEM (o telefone nunca sai).

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) * 1000) / before) / 10 : null);

/** Período anterior de MESMA duração, terminando onde o atual começa. */
export function previousRange(range: ReportRange): ReportRange {
  const length = range.toExclusiveUtc.getTime() - range.fromUtc.getTime();
  const fromUtc = new Date(range.fromUtc.getTime() - length);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: range.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // AAAA-MM-DD local
  return { ...range, fromUtc, toExclusiveUtc: range.fromUtc, fromDate: day(fromUtc), toDate: day(new Date(range.fromUtc.getTime() - 1)) };
}

export async function buildAdvancedReport(storeId: string, range: ReportRange) {
  const sale = Prisma.sql`o."status"::text = ANY(${[...SALE_STATUSES]}) AND o."type"::text <> 'MESA' AND o."awaitingPayment" = false`;
  const oWin = Prisma.sql`o."storeId" = ${storeId} AND o."createdAt" >= ${utc(range.fromUtc)} AND o."createdAt" < ${utc(range.toExclusiveUtc)}`;
  const rWin = Prisma.sql`r."storeId" = ${storeId} AND r."receivedAt" >= ${utc(range.fromUtc)} AND r."receivedAt" < ${utc(range.toExclusiveUtc)}`;
  const tz = range.timeZone;
  // Vendas (pedido + recebimento de mesa) num único conjunto: instante local e valor.
  const sales = Prisma.sql`
    SELECT (o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz} AS "local", (o."totalCents" - o."tipCents") AS "revenue" FROM "Order" o WHERE ${oWin} AND ${sale}
    UNION ALL
    SELECT (r."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz} AS "local", r."totalCents" AS "revenue" FROM "Receipt" r WHERE ${rWin}`;

  const [current, previous, hours, weekdays, staffOrders, staffReceipts, customers] = await Promise.all([
    buildReport(storeId, range),
    buildReport(storeId, previousRange(range)),
    prisma.$queryRaw<{ hour: number; count: bigint; revenue: bigint }[]>(Prisma.sql`
      SELECT extract(hour FROM s."local")::int AS "hour", count(*) AS "count", sum(s."revenue")::bigint AS "revenue" FROM (${sales}) s GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ weekday: number; count: bigint; revenue: bigint }[]>(Prisma.sql`
      SELECT extract(isodow FROM s."local")::int AS "weekday", count(*) AS "count", sum(s."revenue")::bigint AS "revenue" FROM (${sales}) s GROUP BY 1 ORDER BY 1`),
    // Quem ACEITOU o pedido (primeiro CONFIRMADO pelo painel); pedido lançado no painel já nasce aceito pelo atendente.
    prisma.$queryRaw<{ userId: string; email: string; count: bigint; revenue: bigint }[]>(Prisma.sql`
      SELECT u."id" AS "userId", u."email", count(*) AS "count", sum(o."totalCents" - o."tipCents")::bigint AS "revenue"
      FROM "Order" o
      JOIN LATERAL (SELECT h."userId" FROM "OrderStatusHistory" h WHERE h."orderId" = o."id" AND h."status" = 'CONFIRMADO' AND h."userId" IS NOT NULL ORDER BY h."seq" ASC LIMIT 1) a ON true
      JOIN "User" u ON u."id" = a."userId" AND u."storeId" = ${storeId}
      WHERE ${oWin} AND ${sale} GROUP BY u."id", u."email" ORDER BY 4 DESC`),
    prisma.$queryRaw<{ userId: string; email: string; count: bigint; revenue: bigint }[]>(Prisma.sql`
      SELECT u."id" AS "userId", u."email", count(*) AS "count", sum(r."totalCents")::bigint AS "revenue"
      FROM "Receipt" r JOIN "User" u ON u."id" = r."receivedByUserId" AND u."storeId" = ${storeId}
      WHERE ${rWin} GROUP BY u."id", u."email" ORDER BY 4 DESC`),
    // Clientes pelo telefone (só pedidos com telefone): novo = primeira compra no período; recorrente = já comprou antes.
    prisma.$queryRaw<{ total: bigint; returning: bigint; repeatInPeriod: bigint; newRevenue: bigint; returningRevenue: bigint }[]>(Prisma.sql`
      WITH p AS (
        SELECT o."customerPhone" AS "phone", count(*) AS "orders", sum(o."totalCents" - o."tipCents") AS "revenue"
        FROM "Order" o WHERE ${oWin} AND ${sale} AND o."customerPhone" IS NOT NULL GROUP BY 1
      ), before AS (
        SELECT DISTINCT o."customerPhone" AS "phone" FROM "Order" o
        WHERE o."storeId" = ${storeId} AND o."createdAt" < ${utc(range.fromUtc)} AND ${sale} AND o."customerPhone" IN (SELECT "phone" FROM p)
      )
      SELECT count(*) AS "total",
             count(*) FILTER (WHERE p."phone" IN (SELECT "phone" FROM before)) AS "returning",
             count(*) FILTER (WHERE p."orders" >= 2) AS "repeatInPeriod",
             coalesce(sum(p."revenue") FILTER (WHERE p."phone" NOT IN (SELECT "phone" FROM before)), 0)::bigint AS "newRevenue",
             coalesce(sum(p."revenue") FILTER (WHERE p."phone" IN (SELECT "phone" FROM before)), 0)::bigint AS "returningRevenue"
      FROM p`),
  ]);

  const staff = new Map<string, { userId: string; email: string; acceptedOrders: number; acceptedRevenueCents: number; tablesReceived: number; tablesRevenueCents: number }>();
  const entry = (userId: string, email: string) => staff.get(userId) ?? { userId, email, acceptedOrders: 0, acceptedRevenueCents: 0, tablesReceived: 0, tablesRevenueCents: 0 };
  for (const r of staffOrders) staff.set(r.userId, { ...entry(r.userId, r.email), acceptedOrders: n(r.count), acceptedRevenueCents: n(r.revenue) });
  for (const r of staffReceipts) {
    const e = entry(r.userId, r.email);
    staff.set(r.userId, { ...e, tablesReceived: n(r.count), tablesRevenueCents: n(r.revenue) });
  }
  const c = customers[0];
  const total = n(c?.total);
  const returning = n(c?.returning);

  return {
    fromDate: range.fromDate,
    toDate: range.toDate,
    timeZone: tz,
    comparison: {
      previous: { fromDate: previousRange(range).fromDate, toDate: previousRange(range).toDate },
      revenueCents: { current: current.revenueCents, previous: previous.revenueCents, changePercent: pct(current.revenueCents, previous.revenueCents) },
      orderCount: { current: current.orderCount, previous: previous.orderCount, changePercent: pct(current.orderCount, previous.orderCount) },
      averageTicketCents: { current: current.averageTicketCents, previous: previous.averageTicketCents, changePercent: pct(current.averageTicketCents, previous.averageTicketCents) },
      canceledCount: { current: current.canceledCount, previous: previous.canceledCount, changePercent: pct(current.canceledCount, previous.canceledCount) },
    },
    // 24 horas e 7 dias sempre presentes (zero quando não houve venda): a tela desenha o gráfico sem buraco. Dia: 1 = segunda ... 7 = domingo.
    byHour: Array.from({ length: 24 }, (_, hour) => {
      const r = hours.find((h) => h.hour === hour);
      return { hour, orderCount: n(r?.count), revenueCents: n(r?.revenue) };
    }),
    byWeekday: Array.from({ length: 7 }, (_, i) => {
      const r = weekdays.find((w) => w.weekday === i + 1);
      return { weekday: i + 1, orderCount: n(r?.count), revenueCents: n(r?.revenue) };
    }),
    byStaff: [...staff.values()].sort((a, b) => b.acceptedRevenueCents + b.tablesRevenueCents - (a.acceptedRevenueCents + a.tablesRevenueCents)),
    customers: {
      identified: total,
      new: total - returning,
      returning,
      returningPercent: total > 0 ? Math.round((returning * 1000) / total) / 10 : null,
      boughtTwiceOrMoreInPeriod: n(c?.repeatInPeriod),
      newRevenueCents: n(c?.newRevenue),
      returningRevenueCents: n(c?.returningRevenue),
    },
  };
}
