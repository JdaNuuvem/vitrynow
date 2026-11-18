import type { HttpResult } from "../http/HttpClient";
import type { PlanStatus } from "../domain/store";

export interface PlanGateway {
  getStatus(): Promise<HttpResult<PlanStatus>>;
}
