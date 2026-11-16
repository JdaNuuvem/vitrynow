import type { ReactNode } from "react";

// Rótulo + input de texto — o padrão repetido em todos os campos do formulário.
export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  adornment,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  adornment?: ReactNode;
}) {
  return (
    <div className="conta__field">
      {label && <label>{label}</label>}
      <div className="conta__field-input">
        <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        {adornment}
      </div>
    </div>
  );
}
