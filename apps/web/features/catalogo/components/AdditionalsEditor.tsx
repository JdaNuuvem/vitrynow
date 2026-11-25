"use client";

import { MoneyInput } from "@/shared/ui/MoneyInput";
import { emptyAdditional, type AdditionalDraft } from "../productForm";

export function AdditionalsEditor({
  additionals,
  onChange,
}: {
  additionals: AdditionalDraft[];
  onChange: (next: AdditionalDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<AdditionalDraft>) =>
    onChange(additionals.map((additional, i) => (i === index ? { ...additional, ...patch } : additional)));

  return (
    <div className="catalogo-additionals">
      <span className="catalogo-form__label">Adicionais</span>
      {additionals.map((additional, index) => (
        <div key={index} className="catalogo-additionals__row">
          <input
            placeholder="Nome do adicional"
            maxLength={60}
            value={additional.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <div className="catalogo-additionals__price">
            <MoneyInput name={`additional-price-${index}`} value={additional.price} onChange={(price) => update(index, { price })} />
          </div>
          <button
            type="button"
            className="catalogo__btn catalogo__btn--danger"
            onClick={() => onChange(additionals.filter((_, i) => i !== index))}
          >
            remover
          </button>
        </div>
      ))}
      <button type="button" className="catalogo__link" onClick={() => onChange([...additionals, emptyAdditional()])}>
        + adicional
      </button>
    </div>
  );
}
