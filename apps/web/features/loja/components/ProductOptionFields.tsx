import { useId } from "react";
import type { OptionSelection, PublicOptionGroup } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import { changeChoice, choiceMaximum, selectedCount } from "../productOptions";
import "./product-options.css";

type FieldProps = {
  group: PublicOptionGroup;
  selections: OptionSelection[];
  onChange: (next: OptionSelection[]) => void;
  disabled?: boolean;
};

export function ProductOptionFields({ group, selections, onChange, disabled }: FieldProps) {
  const id = useId();
  const count = selectedCount(group, selections);
  const single = group.minSelect === 1 && group.maxSelect === 1;
  const limits = single
    ? "Escolha uma opção"
    : group.minSelect > 0
      ? `Escolha pelo menos ${group.minSelect}${group.maxSelect === null ? "" : ` e até ${group.maxSelect}`}`
      : group.maxSelect === null ? "Opcional" : `Opcional · até ${group.maxSelect}`;

  return (
    <fieldset className="product-choice" disabled={disabled} aria-describedby={`${id}-help`}>
      <legend>{group.name}</legend>
      <p className="product-choice__help" id={`${id}-help`}>
        {limits} · {count} selecionado{count === 1 ? "" : "s"}
        {group.helpText && <span>{group.helpText}</span>}
      </p>
      {group.options.length === 0 && <p className="product-choice__help">Nenhuma opção disponível.</p>}
      <div className="product-choice__list">
        {group.options.map((option) => {
          const quantity = selections.find((entry) => entry.optionId === option.id)?.quantity ?? 0;
          const max = choiceMaximum(group, selections, option.id);
          const price = `${group.priceMode === "SUM" ? "+" : ""}${formatCents(option.priceCents)}`;
          const choose = (next: number) => onChange(changeChoice(group, selections, option.id, next));

          if (group.maxPerOption === 1) {
            return (
              <label className="product-choice__entry" key={option.id}>
                <input
                  type={single ? "radio" : "checkbox"}
                  aria-label={`${option.name} · ${price}`}
                  name={single ? id : undefined}
                  checked={quantity > 0}
                  onChange={(event) => choose(event.target.checked ? 1 : 0)}
                  disabled={!single && !quantity && max === 0}
                />
                <span>{option.name}</span>
                <strong>{price}</strong>
              </label>
            );
          }

          return (
            <div className="product-choice__entry product-choice__entry--step" key={option.id}>
              <span>{option.name}</span><strong>{price}</strong>
              <div className="product-choice__step" role="group" aria-label={`Quantidade de ${option.name}`}>
                <button type="button" disabled={quantity === 0} onClick={() => choose(quantity - 1)} aria-label={`Remover uma unidade de ${option.name}`}>−</button>
                <output aria-live="polite">{quantity}</output>
                <button type="button" disabled={quantity >= max} onClick={() => choose(quantity + 1)} aria-label={`Adicionar uma unidade de ${option.name}`}>+</button>
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
