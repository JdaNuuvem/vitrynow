import type { HttpResult } from "../http/HttpClient";
import type { ReportRange, ReportSummary } from "../domain/reports";

export interface ReportsGateway {
  getSummary(range: ReportRange): Promise<HttpResult<ReportSummary>>;
}
