import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { logAudit } from "../lib/audit";
import { CSV_TABLES, buildReport, reportRows, resolveRange, toCsv, MAX_REPORT_DAYS, type CsvTable } from "../lib/reports";

const RANGE_MESSAGES = {
  INVALID_DATE: "Datas inválidas. Use AAAA-MM-DD.",
  FROM_AFTER_TO: "A data inicial não pode ser depois da final.",
  PERIOD_TOO_LONG: `O período pode ter no máximo ${MAX_REPORT_DAYS} dias.`,
} as const;

// Relatórios do painel (B14): agregados no banco, no fuso da loja, com a definição única de venda (API-21).
const reportRoutes: FastifyPluginAsync = async (app) => {
  const rangeOrReply = (query: { from?: string; to?: string }, reply: FastifyReply) => {
    const range = resolveRange(query);
    if ("error" in range) {
      void reply.code(400).send({ error: RANGE_MESSAGES[range.error], code: range.error });
      return null;
    }
    return range;
  };

  app.get("/api/reports/summary", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const range = rangeOrReply(request.query as { from?: string; to?: string }, reply);
    if (!range) return reply;
    return buildReport(request.user.storeId, range);
  });

  // CSV de cada tabela e do resumo (B14.2). Só o dono baixa (dado financeiro completo; SEC-16); toda exportação fica na auditoria.
  app.get("/api/reports/export.csv", { preHandler: [app.requirePanelAuth, app.requireOwner], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; table?: string };
    const table = (query.table ?? "summary") as CsvTable;
    if (!(CSV_TABLES as readonly string[]).includes(table)) {
      return reply.code(400).send({ error: "Tabela inválida.", code: "INVALID_TABLE", tables: CSV_TABLES });
    }
    const range = rangeOrReply(query, reply);
    if (!range) return reply;
    const { storeId, userId } = request.user;
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
