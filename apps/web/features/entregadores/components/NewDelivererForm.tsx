"use client";

import { useState } from "react";

export function NewDelivererForm({ onCreate }: { onCreate: (name: string, phone: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  async function submit() {
    if (!name.trim()) return;
    await onCreate(name, phone);
    setName("");
    setPhone("");
  }

  return (
    <div className="entregadores__form">
      <input placeholder="Nome" value={name} onChange={(event) => setName(event.target.value)} />
      <input placeholder="Telefone (opcional)" value={phone} onChange={(event) => setPhone(event.target.value)} />
      <button type="button" className="entregadores__primary" onClick={submit}>
        Adicionar
      </button>
    </div>
  );
}
