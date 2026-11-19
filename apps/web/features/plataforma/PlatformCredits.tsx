"use client";

import { useCallback, useState } from "react";
import { Button, DataTable, Panel } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { PlatformCreditAdjustment, creditReasonLabel } from "./PlatformCreditAdjustment";
import { platformApi } from "./platformApi";
import { usePlatform } from "./PlatformShell";
import { platformDate, PlatformState } from "./PlatformUi";
import { usePlatformResource } from "./usePlatformResource";

export function PlatformCredits({ storeId, storeName }: { storeId: string; storeName: string }) {
  const { session } = usePlatform();
  const [adjusting, setAdjusting] = useState(false);
  const [success, setSuccess] = useState(false);
  const load = useCallback(() => platformApi.credits(storeId), [storeId]);
  const { data, error, loading, reload } = usePlatformResource(load);

  return <Panel title="Créditos" className="platform-credit-panel" actions={session.role === "ADMIN" && data ?
    <Button variant="primary" type="button" onClick={() => { setSuccess(false); setAdjusting(true); }}>Registrar lançamento</Button> : undefined}>
    {success && <p className="platform-message platform-message--ok" role="status">Lançamento registrado no extrato.</p>}
    {loading || error ? <PlatformState loading={loading} error={error} retry={reload} /> : data && <>
      <p className="platform-credit-balance"><span>Saldo atual</span><strong>{data.balance} créditos</strong></p>
      {data.entries.length === 0 ? <PlatformState>Nenhum lançamento registrado.</PlatformState> : <>
        <p className="platform-muted">Últimos {data.entries.length} lançamentos</p>
        <DataTable label="Extrato de créditos" headers={["Data", "Operação", "Créditos", "Observação", "Validade"]}>
          {data.entries.map((entry) => <tr key={entry.id}>
            <td>{platformDate(entry.createdAt)}</td><td>{creditReasonLabel(entry.reason)}</td><td><strong>{entry.delta > 0 ? "+" : ""}{entry.delta}</strong></td>
            <td>{entry.note ?? "—"}{entry.externalRef && <small>Ref. {entry.externalRef}</small>}
              {entry.priceCents !== null && <small>{formatCents(entry.priceCents)}</small>}</td><td>{platformDate(entry.expiresAt)}</td>
          </tr>)}
        </DataTable>
      </>}
    </>}
    {adjusting && <PlatformCreditAdjustment storeId={storeId} storeName={storeName} onClose={() => setAdjusting(false)} onDone={() => {
      setAdjusting(false); setSuccess(true); reload();
    }} />}
  </Panel>;
}
