"use client";

import { useState } from "react";
import type { StoreSettings } from "@/core/domain/store";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { Switch } from "@/shared/ui/Switch";
import { toForm, type ContaForm } from "../contaForm";
import type { SaveMessage } from "../hooks/useConta";
import { Field } from "./Field";

export function StoreSettingsCard({
  store,
  onSave,
}: {
  store: StoreSettings;
  onSave: (form: ContaForm) => Promise<SaveMessage>;
}) {
  const [form, setForm] = useState<ContaForm>(() => toForm(store));
  const [message, setMessage] = useState<SaveMessage | null>(null);

  const bind = (key: Exclude<keyof ContaForm, "deliveryEnabled" | "pickupEnabled">) => ({
    value: form[key],
    onChange: (value: string) => setForm((previous) => ({ ...previous, [key]: value })),
  });

  async function save() {
    setMessage(null);
    setMessage(await onSave(form));
  }

  return (
    <div className="conta__card">
      <p className="conta__meta">
        Loja <span>{store.slug}</span> · código {store.code}
      </p>

      <Field label="Nome da loja" {...bind("name")} />
      <Field label="URL do logo (opcional)" placeholder="https://..." {...bind("logoUrl")} />
      <Field
        label="Cor principal (opcional)"
        placeholder="#16a34a"
        adornment={form.primaryColor && <span className="conta__swatch" style={{ backgroundColor: form.primaryColor }} />}
        {...bind("primaryColor")}
      />
      <Field label="URL da capa do cardápio (opcional)" placeholder="https://..." {...bind("coverImageUrl")} />
      <Field label="Endereço (exibido no cardápio público)" placeholder="Rua Exemplo, 123, Centro, Cidade - UF" {...bind("address")} />
      <Field label="WhatsApp (só números com DDI, ex. 5521999999999)" placeholder="5521999999999" {...bind("whatsapp")} />
      <Field label="Horário de funcionamento (texto livre)" placeholder="Seg a sáb, 09:00 às 17:00" {...bind("openingHours")} />

      <div className="conta__field">
        <label>Pedido mínimo em R$ (opcional)</label>
        <MoneyInput
          name="minOrder"
          value={form.minOrder}
          onChange={(value) => setForm((previous) => ({ ...previous, minOrder: value }))}
        />
      </div>

      <div className="conta__field">
        <label>Taxa de entrega em R$ (opcional, somada só nos pedidos de entrega)</label>
        <MoneyInput
          name="deliveryFee"
          value={form.deliveryFee}
          onChange={(value) => setForm((previous) => ({ ...previous, deliveryFee: value }))}
        />
      </div>

      <div className="conta__switches">
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

      {message && <p className={message.kind === "ok" ? "conta__ok" : "conta__error"}>{message.text}</p>}

      <button type="button" className="conta__primary" onClick={save}>
        Salvar
      </button>
    </div>
  );
}
