import type { HttpClient, HttpResult } from "../../http/HttpClient";
import type { PlanGateway } from "../PlanGateway";
import type { PlanStatus } from "../../domain/store";

export class HttpPlanGateway implements PlanGateway {
  constructor(private readonly http: HttpClient) {}

  async getStatus(): Promise<HttpResult<PlanStatus>> {
    const result = await this.http.get<{ plan: PlanStatus }>("/api/store/plan");
    return result.ok ? { ok: true, data: result.data.plan } : result;
  }
}
