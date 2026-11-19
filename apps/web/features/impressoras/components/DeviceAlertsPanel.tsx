"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceAlertCode, DeviceAlerts } from "@/core/gateways/PrintQueueGateway";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { Button, Panel, StateMessage, StatusBadge } from "@/shared/design/components";

const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const labels: Record<DeviceAlertCode, string> = {
  NOTHING_TO_CHARGE_CONFLICT: "Divergência na cobrança do tíquete",
  NOTHING_TO_CHARGE_INVALID: "Valor de cobrança inconsistente",
  EMPTY_ZERO_TICKET: "Tíquete sem itens a cobrar",
  MODE_UNCONFIRMED: "Modo de impressão sem confirmação",
  MODE_RECOVERED: "Modo de impressão confirmado pelo dispositivo",
  QUEUE_WITHOUT_PRINTER: "Fila sem impressora conectada",
};

export function DeviceAlertsPanel() {
  const { printQueue } = usePanelServices();
  const [value, setValue] = useState<HttpResult<DeviceAlerts> | null>(null);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const request = ++revision.current;
    setValue(null);
    const result = await printQueue.alerts();
    if (request === revision.current) setValue(result);
  }, [printQueue]);
  useEffect(() => {
    void load();
    return () => { revision.current++; };
  }, [load]);

  const data = value?.ok ? value.data : null;
  const attention = data?.banner.needsAttention;
  return <Panel title="Alertas dos dispositivos"
    actions={<Button disabled={!value} onClick={() => void load()}>Atualizar alertas</Button>}>
    <div className="print-settings__section">
      {!value && <StateMessage title="Carregando alertas…" busy />}
      {value && !value.ok && <StateMessage tone="danger" title="Falha ao consultar alertas">{value.error}</StateMessage>}
      {attention?.queueWithoutPrinter && <StateMessage tone="warning" title="A fila tem tíquetes e nenhuma impressora conectada">
        Confira se o print-client está aberto no computador e conectado à loja.
      </StateMessage>}
      {attention?.modeUnconfirmed && <StateMessage tone="warning" title="O dispositivo ainda precisa confirmar o modo de impressão">
        Confira a conexão do print-client antes de imprimir.
      </StateMessage>}
      {attention?.moneyAlert && <StateMessage tone="warning" title="Confira os valores dos tíquetes sinalizados">
        Os dispositivos registraram inconsistências em tíquetes nas últimas 24 horas.
      </StateMessage>}
      {data && (data.alerts.length ? <ul className="print-settings__alerts">
        {data.alerts.map((alert) => <li key={alert.id}>
          <div><strong>{labels[alert.code] ?? "Alerta de impressão"}</strong>
            <small>{[date.format(new Date(alert.lastAt)), alert.orderCode && `Pedido #${alert.orderCode}`,
              alert.clientVersion && `Cliente ${alert.clientVersion}`].filter(Boolean).join(" · ")}</small>
          </div>
          <StatusBadge>{alert.count} {alert.count === 1 ? "ocorrência" : "ocorrências"}</StatusBadge>
        </li>)}
      </ul> : <p className="print-settings__muted">Nenhum alerta recente.</p>)}
    </div>
  </Panel>;
}
