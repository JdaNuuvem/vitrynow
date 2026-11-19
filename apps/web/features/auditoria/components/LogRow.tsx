"use client";

import type { AuditLogEntry } from "@/core/domain/audit";
import { auditActionLabel } from "@/core/domain/auditLabels";

export function LogRow({ log }: { log: AuditLogEntry }) {
  return (
    <tr>
      <th scope="row">{auditActionLabel(log.action)}</th>
      <td>{log.userId ? "Usuário da loja" : "Sistema"}</td>
      <td><time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</time></td>
    </tr>
  );
}
