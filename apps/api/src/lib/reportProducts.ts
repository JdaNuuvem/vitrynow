// DADOS i4 (M21): ranking de produtos por período. Identidade estável: agrupa por `productId` (produto renomeado = uma linha; produto excluído
// aparece pelo nome do item no pedido, que é o snapshot do período). Receita INCLUI as opções (mesma conta do buildReport). Produto vendido por
// peso mostra PEDIDOS e KG, nunca gramas como unidades. Fonte das vendas: pedidos de venda (não-MESA) + recebimentos de mesa, como o resumo.
import { Prisma, prisma } from "@meucardapio/db";
import { SALE_STATUSES } from "./saleLines";
import { utc } from "./sqlTime";
import type { ReportPeriod } from "./reportPeriod";

export const PRODUCTS_DEFAULT_LIMIT = 10;
export const PRODUCTS_MAX_LIMIT = 100;

export type ProductRank = {
  productId: string | null;
  categoryId: string | null;
  name: string;
  soldBy: "UN" | "KG";
  quantity: number | null; // unidades vendidas; null quando vendido por peso
  orders: number; // pedidos distintos com o produto
  weightKg: number | null; // só para produto por peso
  revenueCents: number;
};

type Row = { key: string; productId: string | null; categoryId: string | null; name: string; byWeight: boolean; quantity: bigint; grams: bigint; orders: bigint; revenue: bigint };
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

export async function buildProductsRanking(storeId: string, period: ReportPeriod, order: "desc" | "asc", limit: number): Promise<ProductRank[]> {
  const from = utc(period.fromUtc);
  const to = utc(period.toExclusiveUtc);
  const select = Prisma.sql`
    SELECT coalesce(i."productId", i."productName") AS "key", max(i."productId") AS "productId", max(p."categoryId") AS "categoryId",
           max(i."productName") AS "name", bool_or(i."weightGrams" IS NOT NULL) AS "byWeight",
           sum(i."quantity") AS "quantity", coalesce(sum(i."weightGrams" * i."quantity"), 0)::bigint AS "grams",
           count(DISTINCT o."id") AS "orders",
           sum((i."unitPriceCents" + coalesce(a."extra", 0)) * i."quantity")::bigint AS "revenue"
    FROM "OrderItem" i
    JOIN "Order" o ON o."id" = i."orderId"
    LEFT JOIN "Product" p ON p."id" = i."productId" AND p."storeId" = ${storeId}
    LEFT JOIN LATERAL (SELECT sum(x."priceCents") AS "extra" FROM "OrderItemAdditional" x WHERE x."orderItemId" = i."id") a ON true`;
  const [orders, receipts] = await Promise.all([
    prisma.$queryRaw<Row[]>(Prisma.sql`${select}
      WHERE o."storeId" = ${storeId} AND o."awaitingPayment" = false AND o."createdAt" >= ${from} AND o."createdAt" < ${to}
        AND o."status"::text = ANY(${[...SALE_STATUSES]}) AND o."type"::text <> 'MESA'
      GROUP BY 1`),
    prisma.$queryRaw<Row[]>(Prisma.sql`${select}
      JOIN "Receipt" r ON r."id" = o."receiptId"
      WHERE r."storeId" = ${storeId} AND r."receivedAt" >= ${from} AND r."receivedAt" < ${to} AND o."status" <> 'CANCELADO'
      GROUP BY 1`),
  ]);
  const map = new Map<string, { productId: string | null; categoryId: string | null; name: string; byWeight: boolean; quantity: number; grams: number; orders: number; revenue: number }>();
  for (const r of [...orders, ...receipts]) {
    const e = map.get(r.key) ?? { productId: r.productId, categoryId: r.categoryId, name: r.name, byWeight: false, quantity: 0, grams: 0, orders: 0, revenue: 0 };
    e.byWeight ||= r.byWeight;
    e.quantity += n(r.quantity);
    e.grams += n(r.grams);
    e.orders += n(r.orders); // pedido de venda e pedido de mesa são conjuntos disjuntos (não-MESA × recebimento)
    e.revenue += n(r.revenue);
    map.set(r.key, e);
  }
  const dir = order === "asc" ? 1 : -1;
  return [...map.values()]
    .map<ProductRank>((e) => ({
      productId: e.productId,
      categoryId: e.categoryId,
      name: e.name,
      soldBy: e.byWeight ? "KG" : "UN",
      quantity: e.byWeight ? null : e.quantity,
      orders: e.orders,
      weightKg: e.byWeight ? Math.round(e.grams) / 1000 : null,
      revenueCents: e.revenue,
    }))
    // ordem pelo que a tela mostra: unidades (ou pedidos, para peso); empate: receita e depois nome (resultado estável)
    .sort((a, b) => dir * ((a.quantity ?? a.orders) - (b.quantity ?? b.orders)) || dir * (a.revenueCents - b.revenueCents) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
