"use client";

import { useState } from "react";

export function NewCategoryForm({ onCreate }: { onCreate: (name: string, icon: string) => Promise<string | null> }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");

  async function submit() {
    if (!name.trim()) return;
    const failure = await onCreate(name, icon);
    if (failure) return alert(failure);
    setName("");
    setIcon("");
  }

  return (
    <div className="catalogo-new">
      <input
        className="catalogo-new__icon"
        placeholder="Emoji"
        value={icon}
        onChange={(event) => setIcon(event.target.value)}
        maxLength={4}
      />
      <input placeholder="Nova categoria" value={name} onChange={(event) => setName(event.target.value)} />
      <button type="button" className="catalogo__btn catalogo__btn--primary" onClick={submit}>
        Adicionar categoria
      </button>
    </div>
  );
}
