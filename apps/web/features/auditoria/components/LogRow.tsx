"use client";

import type { AuditLogEntry } from "@/core/domain/audit";
import { auditActionLabel } from "@/core/domain/auditLabels";

export function LogRow({ log }: { log: AuditLogEntry }) {
  return (
    <div className="auditoria-row">
      <span>{auditActionLabel(log.action)}</span>
      <time>{new Date(log.createdAt).toLocaleString("pt-BR")}</time>
    </div>
  );
}
