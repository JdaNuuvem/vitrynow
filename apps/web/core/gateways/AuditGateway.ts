import type { HttpResult } from "../http/HttpClient";
import type { AuditLogEntry } from "../domain/audit";

export interface AuditGateway {
  list(): Promise<HttpResult<{ logs: AuditLogEntry[] }>>;
}
