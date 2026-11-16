import { logAudit } from "../lib/audit";

export type AuditEntry = Parameters<typeof logAudit>[0];

// Porta de auditoria: os serviços registram "quem fez o quê" sem saber onde isso é gravado.
export interface AuditLogger {
  log(entry: AuditEntry): void;
}

export const prismaAuditLogger: AuditLogger = { log: logAudit };

// Quem está executando a ação (vem do JWT do painel).
export type Actor = { storeId: string; userId: string };
