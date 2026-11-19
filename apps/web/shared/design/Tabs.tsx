"use client";

import { useId, type KeyboardEvent, type ReactNode } from "react";

export function Tabs<T extends string>({ label, items, selected, onSelect, children }: {
  label: string;
  items: readonly { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
  children: ReactNode;
}) {
  const id = useId();

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const target = event.key === "ArrowRight" ? (index + 1) % items.length
      : event.key === "ArrowLeft" ? (index + last) % items.length
        : event.key === "Home" ? 0 : event.key === "End" ? last : undefined;
    if (target === undefined) return;
    event.preventDefault();
    const next = items[target].id;
    onSelect(next);
    document.getElementById(id + "-" + next)?.focus();
  }

  return (
    <div className="ds-tabs">
      <div className="ds-tabs__list" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button key={item.id} id={id + "-" + item.id} type="button" role="tab" aria-controls={id + "-panel"}
            aria-selected={selected === item.id} tabIndex={selected === item.id ? 0 : -1}
            onClick={() => onSelect(item.id)} onKeyDown={(event) => move(event, index)}>{item.label}</button>
        ))}
      </div>
      <div id={id + "-panel"} role="tabpanel" aria-labelledby={id + "-" + selected} tabIndex={0}>{children}</div>
    </div>
  );
}
