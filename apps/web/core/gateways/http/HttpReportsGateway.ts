import type { HttpClient } from "../../http/HttpClient";
import type { ReportsGateway } from "../ReportsGateway";
import type { ReportRange, ReportSummary } from "../../domain/reports";

export class HttpReportsGateway implements ReportsGateway {
  constructor(private readonly http: HttpClient) {}

  getSummary({ from, to }: ReportRange) {
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    return this.http.get<ReportSummary>(`/api/reports/summary?${query}`);
  }
}
