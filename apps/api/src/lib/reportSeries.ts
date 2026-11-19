// DADOS i6 (M11, M12): pico por hora e por dia da semana, no fuso da LOJA. Sempre 24 e 7 posições (posição sem venda = 0 confirmado, RN-DAD-10).
// Mesma fonte do resumo: pedidos de venda (não-MESA, por createdAt) + recebimentos de mesa (por receivedAt). O agrupamento é no banco, com o
// fuso da loja, então a virada de horário de verão cai na hora local certa (a hora que não existe vem 0; a repetida soma na mesma posição).
import { Prisma, prisma } from "@meucardapio/db";
import { SALE_STATUSES } from "./saleLines";
import { utc } from "./sqlTime";
import type { ReportPeriod } from "./reportPeriod";

export type SeriesPoint = { orderCount: number; revenueCents: number };
export type HourPoint = SeriesPoint & { hour: number }; // 0..23, hora local da loja
export type WeekdayPoint = SeriesPoint & { weekday: number }; // 1 = segunda ... 7 = domingo (ISO)

type Row = { pos: number; count: bigint; revenue: bigint };
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

async function series(storeId: string, period: ReportPeriod, part: "hour" | "isodow"): Promise<Map<number, SeriesPoint>> {
  const tz = period.timeZone;
  const from = utc(period.fromUtc);
  const to = utc(period.toExclusiveUtc);
  const field = Prisma.raw(part);
  const [orders, receipts] = await Promise.all([
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT extract(${field} FROM (o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::int AS "pos", count(*) AS "count",
             coalesce(sum(o."totalCents" - o."tipCents"), 0)::bigint AS "revenue"
      FROM "Order" o
      WHERE o."storeId" = ${storeId} AND o."awaitingPayment" = false AND o."createdAt" >= ${from} AND o."createdAt" < ${to}
        AND o."status"::text = ANY(${[...SALE_STATUSES]}) AND o."type"::text <> 'MESA'
      GROUP BY 1`),
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT extract(${field} FROM (r."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::int AS "pos", count(*) AS "count",
             coalesce(sum(r."totalCents"), 0)::bigint AS "revenue"
      FROM "Receipt" r
      WHERE r."storeId" = ${storeId} AND r."receivedAt" >= ${from} AND r."receivedAt" < ${to}
      GROUP BY 1`),
  ]);
  const map = new Map<number, SeriesPoint>();
  for (const r of [...orders, ...receipts]) {
    const e = map.get(r.pos) ?? { orderCount: 0, revenueCents: 0 };
    e.orderCount += n(r.count);
    e.revenueCents += n(r.revenue);
    map.set(r.pos, e);
  }
  return map;
}

export async function buildByHour(storeId: string, period: ReportPeriod): Promise<HourPoint[]> {
  const m = await series(storeId, period, "hour");
  return Array.from({ length: 24 }, (_, hour) => ({ hour, ...(m.get(hour) ?? { orderCount: 0, revenueCents: 0 }) }));
}

export async function buildByWeekday(storeId: string, period: ReportPeriod): Promise<WeekdayPoint[]> {
  const m = await series(storeId, period, "isodow");
  return Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, ...(m.get(i + 1) ?? { orderCount: 0, revenueCents: 0 }) }));
}
