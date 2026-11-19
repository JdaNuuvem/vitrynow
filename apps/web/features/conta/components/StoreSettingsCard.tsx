"use client";

import { useRef, useState } from "react";
import type { StoreSettings, StoreSettingsInput } from "@/core/domain/store";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { Switch } from "@/shared/ui/Switch";
import { toForm, toPayload, type ContaForm } from "../contaForm";
import type { SaveMessage } from "../hooks/useConta";
import { Field } from "./Field";

export function StoreSettingsCard({
  store,
  onSave,
  canEditCatalogPolicy = false,
  editable = true,
}: {
  store: StoreSettings;
  onSave: (input: StoreSettingsInput) => Promise<SaveMessage>;
  canEditCatalogPolicy?: boolean;
  editable?: boolean;
}) {
  const [form, setForm] = useState<ContaForm>(() => toForm(store));
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const bind = (key: Exclude<keyof ContaForm, "deliveryEnabled" | "pickupEnabled" | "hideSoldOutProducts">) => ({
    value: form[key],
    onChange: (value: string) => setForm((previous) => ({ ...previous, [key]: value })),
  });

  async function save() {
    if (inFlight.current || !editable) return;
    inFlight.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const result = await onSave(toPayload(form));
      if (result.kind === "ok" && result.settings) setForm(toForm(result.settings));
      setMessage(result);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
      <form className="conta__card" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h2>Dados da loja</h2>
        <p className="conta__meta">
          Loja <span>{store.slug}</span> · código {store.code}
        </p>
        {!editable && <p className="conta__meta">A edição dos dados da loja está disponível para o dono.</p>}

        <fieldset className="conta__fields" disabled={!editable || saving}>
        <Field label="Nome da loja" {...bind("name")} />
        <Field label="Endereço (exibido no cardápio público)" placeholder="Rua Exemplo, 123, Centro, Cidade - UF" {...bind("address")} />
        <Field label="WhatsApp (só números com DDI, ex. 5521999999999)" placeholder="5521999999999" {...bind("whatsapp")} />
        <Field label="Horário de funcionamento (texto livre)" placeholder="Seg a sáb, 09:00 às 17:00" {...bind("openingHours")} />

        <label className="conta__field conta__money">
          Pedido mínimo em R$ (opcional)
          <MoneyInput
            name="minOrder"
            value={form.minOrder}
            onChange={(value) => setForm((previous) => ({ ...previous, minOrder: value }))}
          />
        </label>

        <label className="conta__field conta__money">
          Taxa padrão de entrega em R$ (opcional)
          <MoneyInput
            name="deliveryFee"
            value={form.deliveryFee}
            onChange={(value) => setForm((previous) => ({ ...previous, deliveryFee: value }))}
          />
        </label>

        <div className="conta__switches">
          {canEditCatalogPolicy && typeof form.hideSoldOutProducts === "boolean" && (
            <div className="conta__switch">
              <Switch label="Ocultar esgotados no cardápio" checked={form.hideSoldOutProducts}
                onChange={(checked) => setForm((previous) => ({ ...previous, hideSoldOutProducts: checked }))} />
              Ocultar esgotados no cardápio
            </div>
          )}
          <div className="conta__switch">
            <Switch
              label="Aceita entrega"
              checked={form.deliveryEnabled}
              onChange={(checked) => setForm((previous) => ({ ...previous, deliveryEnabled: checked }))}
            />
            Aceita entrega
          </div>
          <div className="conta__switch">
            <Switch
              label="Aceita retirada"
              checked={form.pickupEnabled}
              onChange={(checked) => setForm((previous) => ({ ...previous, pickupEnabled: checked }))}
            />
            Aceita retirada
          </div>
        </div>
        </fieldset>

        {message && <p role={message.kind === "ok" ? "status" : "alert"} className={message.kind === "ok" ? "conta__ok" : "conta__error"}>{message.text}</p>}

        {editable && <button type="submit" className="conta__primary" disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </button>}
      </form>
  );
}
