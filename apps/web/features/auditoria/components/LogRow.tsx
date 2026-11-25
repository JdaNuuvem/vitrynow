"use client";

import type { AuditLogEntry } from "@/core/domain/audit";
import { auditActionLabel } from "@/core/domain/auditLabels";
import { useStoreTimezone } from "@/features/shell/useStoreTimezone";
import { formatInStoreTimezone } from "@/shared/format/storeTime";

export function LogRow({ log }: { log: AuditLogEntry }) {
  const timeZone = useStoreTimezone();
  return (
    <tr>
      <th scope="row">{auditActionLabel(log.action)}</th>
      <td>{log.userId ? "Usuário da loja" : "Sistema"}</td>
      <td><time dateTime={log.createdAt}>{formatInStoreTimezone(log.createdAt, timeZone, { dateStyle: "short", timeStyle: "medium" })}</time></td>
    </tr>
  );
}
