"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PrintConfiguration, PrintMode, PrintModeChange } from "@/core/gateways/PrintQueueGateway";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { Button, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";

const labels: Record<PrintMode, string> = { LEGACY: "Impressão direta", QUEUE: "Fila de impressão" };

export function PrintConfigurationPanel() {
  const { printQueue } = usePanelServices();
  const [value, setValue] = useState<HttpResult<PrintConfiguration> | null>(null);
  const [target, setTarget] = useState<PrintMode | null>(null);
  const [change, setChange] = useState<PrintModeChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const saving = useRef(false);

  const load = useCallback(async () => {
    const request = ++revision.current;
    setValue(null);
    const result = await printQueue.configuration();
    if (request === revision.current) setValue(result);
  }, [printQueue]);

  useEffect(() => {
    void load();
    return () => { revision.current++; };
  }, [load]);

  async function confirm() {
    if (!target || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    const result = await printQueue.setMode(target);
    if (result.ok) {
      setChange(result.data);
      setValue(result);
      setTarget(null);
    } else setError(result.error);
    saving.current = false;
    setBusy(false);
  }

  const mode = value?.ok ? value.data.mode : null;
  const next = mode === "QUEUE" ? "LEGACY" : "QUEUE";
  const conference = value?.ok ? value.data.conference : null;
  const needsCheck = conference && (mode === "QUEUE"
    ? conference.pendingJobOfPrintedOrder + conference.printableOrderWithoutJob
    : conference.printedJobOfUnprintedOrder);

  return <Panel title="Modo de impressão" actions={mode && <StatusBadge tone="info">{labels[mode]}</StatusBadge>}>
    <div className="print-settings__section">
      {!value ? <StateMessage title="Consultando modo de impressão…" busy /> : !value.ok ? (
        <StateMessage title="Falha ao consultar o modo de impressão" tone="danger"
          action={<Button onClick={() => void load()}>Tentar novamente</Button>}>{value.error}</StateMessage>
      ) : <>
        <p>{mode === "QUEUE"
          ? "Os pedidos seguem para o print-client pela fila de impressão da loja."
          : "O print-client consulta os pedidos disponíveis para imprimir diretamente."}</p>
        {Boolean(needsCheck) && <StateMessage tone="warning" title="Há pedidos que precisam de conciliação">
          Confira os alertas e a fila antes de trocar o modo.
        </StateMessage>}
        {change && <StateMessage tone="success" title={change.changed ? "Modo de impressão atualizado" : "Modo de impressão confirmado"}>
          A conciliação registrou {change.reconciled.createdJobs} tíquete(s) novo(s), {change.reconciled.closedPendingJobs} tíquete(s) encerrado(s)
          e {change.reconciled.markedOrdersPrinted} pedido(s) marcado(s) como impresso(s).
        </StateMessage>}
        <Button onClick={() => { setError(null); setChange(null); setTarget(next); }}>
          {next === "QUEUE" ? "Ativar fila" : "Voltar à impressão direta"}
        </Button>
      </>}
      {target && <ConfirmDialog open title={`Usar ${labels[target].toLowerCase()}?`}
        message="O novo modo vale para todos os dispositivos da loja. Os pedidos pendentes serão conciliados durante a troca."
        confirmLabel={busy ? "Salvando…" : "Confirmar modo"} busy={busy} error={error}
        onCancel={() => { if (!saving.current) { setTarget(null); if (error) void load(); } }} onConfirm={() => void confirm()} />}
    </div>
  </Panel>;
}
