import type { HttpResult } from "../http/HttpClient";
import type { AdvancedReport, ReportRange, ReportSummary } from "../domain/reports";

export interface ReportsGateway {
  getSummary(range: ReportRange): Promise<HttpResult<ReportSummary>>;
  /** API-45 (PRO): 402 FEATURE_LOCKED fora do plano; 403 para a equipe. */
  getAdvanced(range: ReportRange): Promise<HttpResult<AdvancedReport>>;
}
