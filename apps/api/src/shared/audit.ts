import { logAudit, logAuditStrict } from "../lib/audit";

export type AuditEntry = Parameters<typeof logAudit>[0];

// Porta de auditoria: os serviços registram "quem fez o quê" sem saber onde isso é gravado.
export interface AuditLogger {
  // Fire-and-forget: mudança de estado (uma falha de log não pode derrubar a ação de negócio).
  log(entry: AuditEntry): void;
  // Estrita: espera a gravação e propaga o erro. Divulgação de dado pessoal só acontece depois que isto resolve.
  logStrict(entry: AuditEntry): Promise<void>;
}

export const prismaAuditLogger: AuditLogger = { log: logAudit, logStrict: logAuditStrict };

// Quem está executando a ação (vem do JWT do painel).
export type Actor = { storeId: string; userId: string };
