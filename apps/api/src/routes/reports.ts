import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { prisma } from "@meucardapio/db";
import { logAudit } from "../lib/audit";
import { storeTimeZone } from "../lib/storeTz";
import { CSV_TABLES, MAX_REPORT_DAYS, buildReport, reportRows, resolveRange, toCsv, type CsvTable } from "../lib/reports";
import { REPORT_RULE_CHANGED_AT } from "../lib/saleLines";
import { previousPeriod } from "../lib/reportPeriod";
import { buildComparison } from "../lib/reportComparison";

// SEC-16 — janela máxima e teto de pedidos por consulta; passou disso, 400/422 com a instrução de reduzir o período (nunca resposta parcial silenciosa).
// A agregação agora é no banco (API-20), mas o teto continua: ele limita também o CSV. O resumo só traz agregados e nomes de produto/entregador:
// nenhum telefone, nome de cliente ou endereço sai daqui (teste trava).
export const REPORT_MAX_WINDOW_DAYS = MAX_REPORT_DAYS;
export const REPORT_MAX_ORDERS = 20_000;
/** Só para teste: baixa o teto sem criar 20 mil pedidos. */
export const reportLimits = { maxOrders: REPORT_MAX_ORDERS };

type Counted = { count: number; revenueCents: number };
/** Visão do STAFF: contagens operacionais e ranking por QUANTIDADE; nenhum valor em reais (RN-R-06). */
export function staffReportView(r: {
  from: string; to: string; orderCount: number; customerCount: number; canceledCount: number; openCount: number;
  byType: Record<string, Counted>; byPaymentMethod: Record<string, Counted>;
  byDay: { date: string; orderCount: number }[]; topProducts: { productName: string; quantity: number }[]; byDeliverer: { delivererName: string; orderCount: number }[];
}) {
  const counts = (m: Record<string, Counted>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { count: v.count }]));
  return {
    from: r.from,
    to: r.to,
    orderCount: r.orderCount,
    customerCount: r.customerCount,
    canceledCount: r.canceledCount,
    openCount: r.openCount,
    byType: counts(r.byType),
    byPaymentMethod: counts(r.byPaymentMethod),
    byDay: r.byDay.map((d) => ({ date: d.date, orderCount: d.orderCount })),
    topProducts: r.topProducts.map((p) => ({ productName: p.productName, quantity: p.quantity })),
    byDeliverer: r.byDeliverer.map((d) => ({ delivererName: d.delivererName, orderCount: d.orderCount })),
  };
}


const RANGE_REPLY = {
  INVALID_DATE: { error: "datas inválidas", code: undefined },
  FROM_AFTER_TO: { error: "A data inicial é depois da final.", code: "REPORT_RANGE_INVALID" },
  PERIOD_TOO_LONG: { error: `Escolha um período de no máximo ${REPORT_MAX_WINDOW_DAYS} dias.`, code: "REPORT_WINDOW_TOO_LARGE", details: { maxDays: REPORT_MAX_WINDOW_DAYS } },
} as const;

// Relatórios do painel (B14): agregados no banco, no fuso da loja, com a definição única de venda (API-21).
const reportRoutes: FastifyPluginAsync = async (app) => {
  // Devolve o período válido ou já responde 400/422 e devolve null.
  async function periodOrReply(storeId: string, query: { from?: unknown; to?: unknown; preset?: unknown }, reply: FastifyReply) {
    if ((query.from !== undefined && typeof query.from !== "string") || (query.to !== undefined && typeof query.to !== "string") || (query.preset !== undefined && typeof query.preset !== "string")) {
      void reply.code(400).send({ error: "datas inválidas" });
      return null;
    }
    const range = resolveRange({ preset: query.preset as string | undefined, from: query.from as string | undefined, to: query.to as string | undefined }, new Date(), await storeTimeZone(storeId));
    if ("error" in range) {
      void reply.code(400).send(RANGE_REPLY[range.error]);
      return null;
    }
    const total = await prisma.order.count({ where: { storeId, awaitingPayment: false, createdAt: { gte: range.fromUtc, lt: range.toExclusiveUtc } } });
    if (total > reportLimits.maxOrders) {
      void reply.code(422).send({ error: "Há pedidos demais nesse período. Escolha um intervalo menor.", code: "REPORT_TOO_LARGE", details: { maxOrders: reportLimits.maxOrders } });
      return null;
    }
    return range;
  }

  app.get("/api/reports/summary", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId } = request.user;
    const range = await periodOrReply(storeId, request.query as { from?: unknown; to?: unknown }, reply);
    if (!range) return reply;
    const current = await buildReport(storeId, range);
    const full = { ...current, ruleChangedAt: REPORT_RULE_CHANGED_AT };
    // RN-R-06 / CA-R-15: dinheiro é do OWNER. O STAFF recebe só CONTAGENS (campos em reais AUSENTES, não zerados).
    const view = request.user.role === "OWNER" ? full : { ...staffReportView(full), partial: current.partial };
    // i3 (M13): `?compare=prev` liga o comparativo com o período anterior de MESMO tamanho (hoje: mesmo dia da semana, até a mesma hora).
    if ((request.query as { compare?: unknown }).compare !== "prev") return view;
    const prevRange = previousPeriod(range, new Date());
    const comparison = buildComparison(current, await buildReport(storeId, prevRange), prevRange, request.user.role === "OWNER" ? "OWNER" : "STAFF");
    return { ...view, comparison };
  });

  // CSV de cada tabela e do resumo (B14.2). Só o dono baixa (dado financeiro completo; SEC-16); toda exportação fica na auditoria.
  app.get("/api/reports/export.csv", { preHandler: [app.requirePanelAuth, app.requireOwner], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const query = request.query as { from?: unknown; to?: unknown; table?: string };
    const table = (query.table ?? "summary") as CsvTable;
    if (!(CSV_TABLES as readonly string[]).includes(table)) {
      return reply.code(400).send({ error: "Tabela inválida.", code: "INVALID_TABLE", tables: CSV_TABLES });
    }
    const { storeId, userId } = request.user;
    const range = await periodOrReply(storeId, query, reply);
    if (!range) return reply;
    const report = await buildReport(storeId, range);
    logAudit({ storeId, userId, action: "report.export", targetType: "Store", targetId: storeId, metadata: { table, from: range.fromDate, to: range.toDate } });
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="relatorio-${table}-${range.fromDate}-a-${range.toDate}.csv"`)
      .header("Cache-Control", "no-store")
      .send(toCsv(reportRows(report, table)));
  });
};

export default reportRoutes;
