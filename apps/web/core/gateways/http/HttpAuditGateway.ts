import type { HttpClient } from "../../http/HttpClient";
import type { AuditGateway } from "../AuditGateway";
import type { AuditLogEntry } from "../../domain/audit";

export class HttpAuditGateway implements AuditGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<{ logs: AuditLogEntry[] }>("/api/audit-log");
  }
}
