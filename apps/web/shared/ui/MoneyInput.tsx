"use client";

import { maskMoneyInput } from "../format/money";

type MoneyInputProps = {
  value: string;
  onChange: (maskedValue: string) => void;
  name: string;
  id?: string;
  autoFocus?: boolean;
};

export function MoneyInput({ value, onChange, name, id, autoFocus }: MoneyInputProps) {
  return (
    <div className="money-input">
      <span>R$</span>
      <input
        type="text"
        id={id}
        name={name}
        inputMode="numeric"
        placeholder="00,00"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(maskMoneyInput(event.target.value))}
      />
    </div>
  );
}
