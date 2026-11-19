import { useState } from "react";
import type { ZoneConfig } from "@/core/gateways/DeliveryZonesGateway";
import { digitsToCents, formatCents, maskMoneyInput } from "@/shared/format/money";
import { MoneyInput } from "@/shared/ui/MoneyInput";

export function ZoneRules({ config, editable, busy, onSave }: {
  config: ZoneConfig; editable: boolean; busy: boolean;
  onSave: (value: Omit<ZoneConfig, "defaultFeeCents">) => void;
}) {
  const [mode, setMode] = useState(config.outsideMode);
  const [threshold, setThreshold] = useState(maskMoneyInput(config.freeShippingFromCents?.toString() ?? ""));
  return (
    <section className="zones-panel zones-rules">
      <h2>Regras de entrega</h2>
      <form onSubmit={event => { event.preventDefault(); onSave({ outsideMode: mode, freeShippingFromCents: threshold ? digitsToCents(threshold) : null }); }}>
        <fieldset disabled={!editable || busy}>
          <label>Outros bairros<select value={mode} onChange={event => setMode(event.target.value as ZoneConfig["outsideMode"])}>
            <option value="REFUSE">Fora da área de entrega</option>
            <option value="DEFAULT_FEE">Cobrar taxa padrão de {formatCents(config.defaultFeeCents)}</option>
          </select></label>
          <label>Frete grátis geral a partir de<MoneyInput name="delivery-free-from" value={threshold} onChange={setThreshold} /></label>
          {editable && <button>Salvar regras</button>}
        </fieldset>
      </form>
    </section>
  );
}
