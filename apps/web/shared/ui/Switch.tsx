"use client";

import "./ui.css";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
};

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`ui-switch${checked ? " ui-switch--on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch__knob" />
    </button>
  );
}
