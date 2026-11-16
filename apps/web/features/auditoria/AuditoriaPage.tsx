"use client";

import "./auditoria.css";
import { LogRow } from "./components/LogRow";
import { useAuditoria } from "./hooks/useAuditoria";

export function AuditoriaPage() {
  const { logs, forbidden } = useAuditoria();

  if (forbidden) return <main className="auditoria">Essa área é restrita ao dono da loja.</main>;

  return (
    <main className="auditoria">
      <h1>Log de auditoria</h1>
      <p className="auditoria__intro">Ações sensíveis da conta — útil pra investigar quem fez o quê.</p>

      <div className="auditoria__list">
        {logs?.map((log) => <LogRow key={log.id} log={log} />)}
        {logs?.length === 0 && <p className="auditoria__empty">Nenhuma ação registrada ainda.</p>}
      </div>
    </main>
  );
}
