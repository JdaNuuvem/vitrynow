"use client";

import { maskMoneyInput } from "../format/money";

type MoneyInputProps = {
  value: string;
  onChange: (maskedValue: string) => void;
  name: string;
  id?: string;
  autoFocus?: boolean;
};

// Teto de dígitos do campo: 10 dígitos = até R$ 99.999.999,99. Acima disso o servidor recusa qualquer valor de dinheiro,
// então o campo para de aceitar dígitos em vez de deixar a pessoa digitar um número sem fim.
export const MONEY_INPUT_MAX_DIGITS = 10;
const capDigits = (raw: string) => raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MONEY_INPUT_MAX_DIGITS);

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
        onChange={(event) => onChange(maskMoneyInput(capDigits(event.target.value)))}
      />
    </div>
  );
}
